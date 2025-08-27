# jobs\benchmark\worker\runner.py
import json, os, traceback, platform, sys, time, threading
from datetime import datetime
from collections import defaultdict
from tqdm import tqdm
# jobs\benchmark\reports\graphics.py
from jobs.benchmark.reports.graphics import generate_benchmark_report
#from reports.graphics import generate_benchmark_report

# Force-load plugins so registries are populated
import jobs.benchmark.evaluations  # noqa: F401
import jobs.benchmark.datasets     # noqa: F401  (datasets/__init__.py should import loaders)

from ..core.config import JobConfig
from ..core.persistence import make_engine, init_db, make_session_factory, WriterThread
from ..core.models import (
    Provider, Model, Dataset, DatasetVariant, Utterance,
    Benchmark, JobRun, Prediction, LatencySample
)
from jobs.benchmark.core.registry import EVAL_REGISTRY, RunContext

from jobs.benchmark.worker.plan  import build_tasks
from jobs.benchmark.worker.exec_infer import run_parallel, RateLimiter
from jobs.benchmark.providers.openai_whisper import make_openai_provider
from jobs.benchmark.providers.deepgram import make_deepgram_provider
from sqlalchemy.exc import IntegrityError


# -----------------------
# Provider factory
# -----------------------
def choose_provider(name: str, api_key: str):
    if name == "openai":
        return make_openai_provider(api_key)
    if name == "deepgram":
        return make_deepgram_provider(api_key)
    raise ValueError(f"Unknown provider: {name}")


# -----------------------
# Upserts via ORM
# -----------------------
def ensure_provider_and_model(s, provider_name: str, model_name: str):
    p = s.query(Provider).filter_by(name=provider_name).one_or_none()
    if p is None:
        p = Provider(name=provider_name, sdk="python", sdk_version="", extra_json={})
        s.add(p); s.flush()
    m = s.query(Model).filter_by(provider_id=p.provider_id, name=model_name).one_or_none()
    if m is None:
        m = Model(provider_id=p.provider_id, name=model_name, revision="", params_json={})
        s.add(m); s.flush()
    return p, m


def ensure_dataset_and_variant(s, dataset_name: str, subset_meta: dict | None):
    d = s.query(Dataset).filter_by(name=dataset_name).one_or_none()
    if d is None:
        d = Dataset(name=dataset_name, source="", license="", checksum="", notes="")
        s.add(d); s.flush()
    v = (
        s.query(DatasetVariant)
        .filter_by(dataset_id=d.dataset_id, split=None, variant_json=subset_meta or {})
        .one_or_none()
    )
    if v is None:
        v = DatasetVariant(dataset_id=d.dataset_id, split=None, variant_json=subset_meta or {})
        s.add(v); s.flush()
    return d, v


# -----------------------
# Helpers
# -----------------------
def _prediction_exists(Session, job_run_id: int, utt_pk: int) -> bool:
    """Check if this utterance already has a prediction for the given run (to avoid re-calling the API)."""
    with Session() as s:
        return s.query(Prediction.prediction_id).filter_by(job_run_id=job_run_id, utt_pk=utt_pk).first() is not None


def _cap_tasks(tasks, max_utterances: int | None, max_per_subset: int | None):
    """Optionally trim the task list for testing."""
    if max_per_subset and max_per_subset > 0:
        grouped = defaultdict(list)

        def subset_key(task):
            ds_name, subset_meta = task.dataset_key  # ("librispeech", {"subset":"clean", ...})
            subset_tuple = tuple(sorted((subset_meta or {}).items()))
            return (ds_name, subset_tuple)

        for t in tasks:
            grouped[subset_key(t)].append(t)

        trimmed = []
        for _, lst in grouped.items():
            trimmed.extend(lst[:max_per_subset])
        tasks = trimmed

    if max_utterances and max_utterances > 0:
        tasks = tasks[:max_utterances]

    return tasks


# -----------------------
# Main entrypoint
# -----------------------
def post_onboard_evaluation(
    config_json: str,
    db_url="sqlite:///spectragram.db",
    cancel_event: threading.Event | None = None,
    max_utterances: int | None = None,
    max_per_subset: int | None = None,
):
    cfg = JobConfig.model_validate(json.loads(config_json))

    # pick provider key from ApiKeys map
    api_key = cfg.ApiKeys.get(cfg.Provider, "")
    if not api_key:
        raise RuntimeError(f"Missing API key for provider '{cfg.Provider}' in ApiKeys")

    # DB
    engine = make_engine(db_url)
    init_db(engine)
    Session = make_session_factory(engine)

    # materialize eval policy
    eval_pipeline = EVAL_REGISTRY[cfg.EvaluationVersion]
    inf = eval_pipeline.inference_profile()

    # Decide: completed → return; else resume or create
    resume_mode = False
    job_run_id = None
    with Session() as s:
        b = s.get(Benchmark, cfg.BenchmarkID)
        if b:
            # get the most recent run for this benchmark
            last = (
                s.query(JobRun)
                .filter_by(benchmark_id=b.benchmark_id)
                .order_by(JobRun.job_run_id.desc())
                .first()
            )
            if last and last.status == "completed":
                # nothing to do; return info
                report_paths = {}
                try:
                    report_paths = generate_benchmark_report(
                        db_url=db_url,                # use the same DB URL you passed in
                        benchmark_id=cfg.BenchmarkID,
                        job_run_id=job_run_id,        # explicit; avoids any ambiguity
                    )
                    # Optional: print a short summary to stdout/log
                    print(f"[report] saved under reports/{cfg.BenchmarkID}")
                except Exception as e:
                    print(f"[report] failed to generate: {e}")
                return {
                    "status": "already_completed",
                    "message": "Benchmark previously completed.",
                    "benchmark_id": b.benchmark_id,
                    "job_run_id": last.job_run_id,
                    "completed_at": last.ended_at.isoformat() if last.ended_at else None,
                }
            elif last and last.status in ("running", "failed"):
                # resume this run
                resume_mode = True
                job_run_id = last.job_run_id
                # bring it back to running
                last.status = "running"
                last.ended_at = None
                last.error_text = ""
                s.commit()
        # If no benchmark or no run to resume, we'll create fresh below.

    writer = WriterThread(Session); writer.start()
    provider = choose_provider(cfg.Provider, api_key)

    # Build tasks (datasets define their own subsets)
    tasks = build_tasks(cfg)

    # Apply optional test caps
    tasks = _cap_tasks(tasks, max_utterances=max_utterances, max_per_subset=max_per_subset)

    # Create new benchmark & job_run if not resuming
    if not resume_mode:
        with Session() as s:
            b = s.get(Benchmark, cfg.BenchmarkID)
            if b is None:
                b = Benchmark(
                    benchmark_id=cfg.BenchmarkID,
                    created_at=datetime.utcnow(),
                    config_json=cfg.model_dump(),
                    notes=cfg.RunNotes or ""
                )
                s.add(b)
            provider_row, model_row = ensure_provider_and_model(s, cfg.Provider, cfg.Model)
            jr = JobRun(
                benchmark_id=b.benchmark_id,
                provider_id=provider_row.provider_id,
                model_id=model_row.model_id,
                eval_version=cfg.EvaluationVersion,
                started_at=datetime.utcnow(),
                status="running",
                env_json={"python": sys.version, "platform": platform.platform()},
                host_info_json={}
            )
            s.add(jr); s.flush()
            job_run_id = jr.job_run_id
            s.commit()

    # Limiter: use only when we actually call the provider (skips don't rate-limit)
    limiter = RateLimiter(inf["rps"], cancel_event=cancel_event)

    # --------- Per-utterance pipeline ----------
    def infer_one(task):
        # early out on cancel
        if cancel_event is not None and cancel_event.is_set():
            return "cancelled"

        # Ensure dataset/variant/utt
        ids_holder = {}

        def upsert_entities(session):
            d, v = ensure_dataset_and_variant(session, task.dataset_key[0], task.dataset_key[1])
            u = (
                session.query(Utterance)
                .filter_by(dataset_id=d.dataset_id, variant_id=v.variant_id, external_id=task.utt.utt_id)
                .one_or_none()
            )
            if u is None:
                u = Utterance(
                    dataset_id=d.dataset_id,
                    variant_id=v.variant_id,
                    external_id=task.utt.utt_id,
                    audio_path=task.utt.audio_path,
                    ref_text=task.utt.ref_text,
                    duration_s=task.utt.duration_s,
                    meta_json=task.utt.meta or {}
                )
                session.add(u); session.flush()
            ids_holder["ids"] = (d.dataset_id, v.variant_id, u.utt_pk)

        writer.submit(upsert_entities)
        while "ids" not in ids_holder:
            if cancel_event is not None and cancel_event.is_set():
                return "cancelled"
            time.sleep(0.001)
        dataset_id, variant_id, utt_pk = ids_holder["ids"]

        # Skip if already done for this run
        if _prediction_exists(Session, job_run_id, utt_pk):
            return "skipped"

        # Check cancel before external call
        if cancel_event is not None and cancel_event.is_set():
            return "cancelled"

        # Rate limit (cooperative)
        limiter.wait()

        # Final preflight
        if cancel_event is not None and cancel_event.is_set():
            return "cancelled"

        # Inference with per-utterance error isolation
        params = {"model": cfg.Model, "language": "en", "timeout_s": inf["timeout_s"]}
        try:
            (result, elapsed_s) = provider.transcribe(task.utt.audio_path, params)
        except Exception as e:
            # Log & skip; this utterance can be retried on resume
            print(f"[warn] inference failed (utt={task.utt.utt_id}): {e}")
            return "error"

        # Save prediction + latency
        def write_pred(session):
            try:
                session.add(Prediction(
                    job_run_id=job_run_id,
                    utt_pk=utt_pk,
                    hyp_text=result.text,
                    words_json=result.words or {},
                    usage_json=result.usage or {}
                ))
                # RTF: ensure not None if your DB has NOT NULL constraint.
                if task.utt.duration_s and task.utt.duration_s > 0:
                    rtf_val = elapsed_s / task.utt.duration_s
                    lat_meta = {}
                else:
                    # Fallback to 0.0 and mark that duration was missing
                    rtf_val = 0.0
                    lat_meta = {"rtf_missing_duration": True}

                session.add(LatencySample(
                    job_run_id=job_run_id,
                    utt_pk=utt_pk,
                    api_time_ms=elapsed_s * 1000.0,
                    total_time_ms=elapsed_s * 1000.0,
                    rtf=rtf_val,           # never None now
                    meta_json=lat_meta
                ))
            except IntegrityError:
                session.rollback()
        writer.submit(write_pred)
        return "ok"

    # Run pool with cooperative cancel; keep tqdm responsive
    try:
        desc = "Resume" if resume_mode else "Infer"
        results = run_parallel(
            tasks, infer_one, inf["concurrency"], rps=10**9, cancel_event=cancel_event
        )
        for _ in tqdm(range(len(results)), total=len(tasks), desc=desc):
            pass

        # If user cancelled, mark aborted and skip evaluation
        if cancel_event is not None and cancel_event.is_set():
            with Session() as s:
                jr = s.get(JobRun, job_run_id)
                jr.status = "aborted"; jr.ended_at = datetime.utcnow()
                s.commit()
            return {
                "status": "aborted",
                "benchmark_id": cfg.BenchmarkID,
                "job_run_id": job_run_id,
            }

        # Evaluate & finalize
        run_ctx = RunContext(session_factory=Session, job_run_id=job_run_id, cfg=cfg, logger=print)
        eval_pipeline.run(run_ctx)
        with Session() as s:
            jr = s.get(JobRun, job_run_id)
            jr.status = "completed"; jr.ended_at = datetime.utcnow()
            s.commit()
        report_paths = {}
        try:
            report_paths = generate_benchmark_report(
                db_url=db_url,                # use the same DB URL you passed in
                benchmark_id=cfg.BenchmarkID,
                job_run_id=job_run_id,        # explicit; avoids any ambiguity
            )
            # Optional: print a short summary to stdout/log
            print(f"[report] saved under reports/{cfg.BenchmarkID}")
        except Exception as e:
            print(f"[report] failed to generate: {e}")
        return {
            "status": "completed",
            "benchmark_id": cfg.BenchmarkID,
            "job_run_id": job_run_id,
            "resumed": resume_mode
        }


    except KeyboardInterrupt:
        # User pressed Ctrl+C mid-run: mark aborted and exit
        if cancel_event is not None:
            cancel_event.set()
        with Session() as s:
            jr = s.get(JobRun, job_run_id)
            if jr:
                jr.status = "aborted"; jr.ended_at = datetime.utcnow()
                s.commit()
        return {
            "status": "aborted",
            "benchmark_id": cfg.BenchmarkID,
            "job_run_id": job_run_id,
        }
    finally:
        writer.stop()
