# processor/job_runner.py
from __future__ import annotations

import os
import time
import json
import traceback
from datetime import datetime
from typing import Any, Dict, List, Optional, Set, Tuple

import requests
from sqlalchemy.orm import Session as SASession
from sqlalchemy import create_engine

from jobs.post_onboard import run_benchmark_from_config, run_benchmark_from_dict

# Import ORM models from the package path
from jobs.benchmark.core.models import (
    Dataset, DatasetVariant, JobRun, MetricSummary, BootstrapResult,
    Provider as ProviderTbl, Model as ModelTbl, Prediction, Utterance
)

# ----------------------------- Configuration -----------------------------
DEFAULT_BENCHMARK_DB_URL = os.getenv("BENCHMARK_DB_URL", "sqlite:///jobs/benchmark/spectragram.db")
BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:5000")
GET_JOBS_ENDPOINT = f"{BACKEND_URL}/api/worker/get_job_to_run"
UPDATE_JOB_ENDPOINT = f"{BACKEND_URL}/api/worker/pick_up_job"

DEFAULT_SUPPORTED_JOBS: Set[str] = {"post_onboard_eval"}

REQUEST_TIMEOUT = float(os.getenv("JOB_RUNNER_TIMEOUT_SEC", "15"))
SLEEP_IF_EMPTY = float(os.getenv("JOB_RUNNER_IDLE_SLEEP_SEC", "3"))

# DB that the benchmark writes to
BENCHMARK_DB_URL = os.getenv(
    "BENCHMARK_DB_URL",
    "sqlite:///jobs/benchmark/spectragram.db"
)

# ------------------------------- Utilities -------------------------------

def _log(msg: str) -> None:
    print(f"[job-runner] {msg}", flush=True)

def _http_get_json(url: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    r = requests.get(url, params=params, timeout=REQUEST_TIMEOUT)
    r.raise_for_status()
    try:
        return r.json()
    except Exception:
        # Fall back to text for debugging
        raise RuntimeError(f"Non-JSON response from {url}: {r.text[:500]}")

def _http_post_json(url: str, body: Dict[str, Any]) -> Dict[str, Any]:
    try:
        r = requests.post(url, json=body, timeout=REQUEST_TIMEOUT)
        r.raise_for_status()
        return r.json()
    except requests.HTTPError as e:
        # ⇩ shows the Flask error details (stack or JSON) in your worker logs
        txt = getattr(e.response, "text", "")
        print(f"[job-runner] pick_up_job HTTPError {e.response.status_code}: {txt[:2000]}", flush=True)
        raise

def _iso_now() -> str:
    return datetime.utcnow().replace(microsecond=0).isoformat() + "Z"

# ------------------------------ API Adapters ------------------------------

def fetch_jobs_to_run(limit: Optional[int] = None) -> List[Dict[str, Any]]:
    params: Dict[str, Any] = {}
    if limit is not None:
        params["limit"] = str(limit)
    payload = _http_get_json(GET_JOBS_ENDPOINT, params=params)
    jobs = payload.get("jobs") or []
    if not isinstance(jobs, list):
        raise RuntimeError("Malformed /get_job_to_run payload: 'jobs' must be a list")
    return jobs

def update_job(job_id: str, **fields: Any) -> Dict[str, Any]:
    """
    POST /api/worker/pick_up_job
    Body:
      {
        "id": "<job_id>",
        "updates": { ...fields... }
      }
    """
    body: Dict[str, Any] = {"id": job_id, "updates": {}}
    for k, v in fields.items():
        body["updates"][k] = v
    result = _http_post_json(UPDATE_JOB_ENDPOINT, body)
    return result.get("job", result)

# ----------------------- Metric Summary (DB → JSON) -----------------------

_METHOD_PRIORITY = [
    "bootstrap_percentile",        # preferred
    "orderstat_normal_approx",     # fallback
]

def _choose_ci(ci_rows: List[BootstrapResult], metric: str) -> Optional[Tuple[float, float, str]]:
    """
    Given a list of BootstrapResult rows for a single (dataset_id, variant_id),
    pick best CI for a metric by method priority, then by #iterations.
    """
    cands = [b for b in ci_rows if b.metric == metric]
    if not cands:
        return None

    def score(b: BootstrapResult) -> Tuple[int, int]:
        try:
            idx = _METHOD_PRIORITY.index(b.method)
        except ValueError:
            idx = len(_METHOD_PRIORITY) + 1
        iters = int(b.iterations or 0)
        return (idx, -iters)

    best = min(cands, key=score)
    return float(best.ci_low), float(best.ci_high), str(best.method)

def _counts_by_variant(session: SASession, job_run_id: int) -> Dict[Tuple[int, int], int]:
    rows = (
        session.query(Utterance.dataset_id, Utterance.variant_id)
        .join(Prediction, Prediction.utt_pk == Utterance.utt_pk)
        .filter(Prediction.job_run_id == job_run_id)
        .all()
    )
    c: Dict[Tuple[int, int], int] = {}
    for ds_id, var_id in rows:
        key = (int(ds_id), int(var_id))
        c[key] = c.get(key, 0) + 1
    return c

def _variant_label(vjson: Optional[dict], ds_name: str) -> str:
    if not vjson:
        return f"{ds_name} [default]"
    parts = [f"{k}={v}" for k, v in sorted(vjson.items(), key=lambda kv: kv[0])]
    return f"{ds_name} [{', '.join(parts)}]"

def _collect_metric_summary_json(
    db_url: str,
    benchmark_id: str,
    job_run_id: int,
) -> List[Dict[str, Any]]:
    """
    Build a tidy metric summary (similar to reports/summary.csv) and return as JSON.
    """
    engine = create_engine(db_url, future=True)
    out_rows: List[Dict[str, Any]] = []

    with SASession(engine) as s:
        jr: JobRun = s.get(JobRun, job_run_id)
        if not jr:
            return out_rows

        prov = s.get(ProviderTbl, jr.provider_id)
        mod = s.get(ModelTbl, jr.model_id)

        ds_map = {d.dataset_id: d.name for d in s.query(Dataset).all()}
        var_map = {v.variant_id: v.variant_json for v in s.query(DatasetVariant).all()}

        metrics = s.query(MetricSummary).filter_by(job_run_id=job_run_id).all()
        if not metrics:
            return out_rows

        from collections import defaultdict
        by_key: Dict[Tuple[int, int], Dict[str, float]] = defaultdict(dict)
        for m in metrics:
            key = (int(m.dataset_id), int(m.variant_id))
            by_key[key][m.metric] = float(m.value)

        ci_index: Dict[Tuple[int, int], List[BootstrapResult]] = defaultdict(list)
        for b in s.query(BootstrapResult).filter_by(job_run_id=job_run_id).all():
            ci_index[(int(b.dataset_id), int(b.variant_id))].append(b)

        counts = _counts_by_variant(s, job_run_id)

        for (ds_id, var_id), metric_map in by_key.items():
            ds_name = ds_map.get(ds_id, f"ds:{ds_id}")
            vjson = var_map.get(var_id)
            label = _variant_label(vjson, ds_name)
            n = counts.get((ds_id, var_id))

            cis = ci_index.get((ds_id, var_id), [])

            def pick(metric_name: str) -> Tuple[Optional[float], Optional[float]]:
                c = _choose_ci(cis, metric_name)
                return (c[0], c[1]) if c else (None, None)

            wer = metric_map.get("wer")
            wer_lo, wer_hi = pick("wer")

            lp50 = metric_map.get("latency_p50_ms")
            lp50_lo, lp50_hi = pick("latency_p50_ms")

            lp95 = metric_map.get("latency_p95_ms")
            lp95_lo, lp95_hi = pick("latency_p95_ms")

            rtfm = metric_map.get("rtf_mean")
            rtfm_lo, rtfm_hi = pick("rtf_mean")

            rtfp = metric_map.get("rtf_p95")
            rtfp_lo, rtfp_hi = pick("rtf_p95")

            out_rows.append({
                "benchmark_id": benchmark_id,
                "job_run_id": job_run_id,
                "provider": getattr(prov, "name", None),
                "model": getattr(mod, "name", None),
                "eval_version": jr.eval_version,

                "label": label,
                "dataset_id": ds_id,
                "variant_id": var_id,
                "n_utterances": n,

                "wer": wer,
                "wer_ci_low": wer_lo,
                "wer_ci_high": wer_hi,

                "latency_p50_ms": lp50,
                "latency_p50_ms_ci_low": lp50_lo,
                "latency_p50_ms_ci_high": lp50_hi,

                "latency_p95_ms": lp95,
                "latency_p95_ms_ci_low": lp95_lo,
                "latency_p95_ms_ci_high": lp95_hi,

                "rtf_mean": rtfm,
                "rtf_mean_ci_low": rtfm_lo,
                "rtf_mean_ci_high": rtfm_hi,

                "rtf_p95": rtfp,
                "rtf_p95_ci_low": rtfp_lo,
                "rtf_p95_ci_high": rtfp_hi,
            })

    return out_rows

# ------------------------- Job Handlers (Implement) ------------------------

def post_onboard_evaluation(*, job: Dict[str, Any]) -> Dict[str, Any]:
    _log(f"Running post_onboard_evaluation for job={job.get('id')} model={job.get('model_id')}")
    payload = job.get("payload") or {}

    # ✅ Resolve a single db_url that both writer and reader will use
    db_url = (
        payload.get("db_url")
        or os.getenv("BENCHMARK_DB_URL")
        or DEFAULT_BENCHMARK_DB_URL
    )

    max_n = payload.get("max_per_subset")
    config_path = payload.get("config_path") or payload.get("config_name")

    try:
        if config_path:
            result = run_benchmark_from_config(config_path, max_per_subset=max_n, db_url=db_url)  # <-- pass db_url
        else:
            config_dict = payload.get("config") or payload.get("config_dict")
            if not isinstance(config_dict, dict):
                raise ValueError("payload must include 'config' (object) or 'config_path' (string)")
            result = run_benchmark_from_dict(config_dict, max_per_subset=max_n, db_url=db_url)   # <-- pass db_url
    except Exception as e:
        return {"ok": False, "error": f"{type(e).__name__}: {e}"}

    ok = result.get("status") in ("completed", "already_completed")
    benchmark_id = result.get("benchmark_id")
    job_run_id = result.get("job_run_id")
    resumed = result.get("resumed", False)

    summary_json = []
    summary_error = None

    if ok and benchmark_id and job_run_id:
        try:
            # ✅ Read from the same db_url we used to write
            summary_json = _collect_metric_summary_json(db_url, str(benchmark_id), int(job_run_id))
        except Exception as e:
            summary_error = f"metric_summary_failed: {type(e).__name__}: {e}"

    return {
        "ok": ok,
        "status": result.get("status"),
        "benchmark_id": benchmark_id,
        "job_run_id": job_run_id,
        "resumed": resumed,
        "finished_at": _iso_now(),
        "metric_summary": summary_json,
        "metric_summary_error": summary_error,
    }

# Registry to route job_type → handler
JOB_HANDLERS = {
    "post_onboard_eval": post_onboard_evaluation,
}

# ----------------------------- Core Runner Loop -----------------------------

def handle_job(job: Dict[str, Any]) -> Tuple[bool, Dict[str, Any]]:
    """
    Execute a single job:
      1) mark processing
      2) run handler
      3) mark done & write results (or failed)
    """
    job_id = job.get("id")
    if not job_id:
        _log("Skipping job with no id.")
        return False, {"error": "missing job id"}

    job_type = job.get("job_type")
    attempts = int(job.get("attempts") or 0)

    # Step 1: transition to processing
    try:
        update_job(job_id, status="processing", attempts=attempts + 1, run_at="now")
    except Exception as e:
        _log(f"Failed to mark job processing (id={job_id}): {e}")
        return False, {"error": f"update to processing failed: {e}"}

    handler = JOB_HANDLERS.get(job_type)
    if not handler:
        msg = f"unsupported job_type: {job_type}"
        _log(msg)
        try:
            update_job(job_id, status="failed", last_error=msg)
        except Exception as e2:
            _log(f"Also failed to mark job failed (id={job_id}): {e2}")
        return False, {"error": msg}

    # Step 2: run job handler
    try:
        result_payload = handler(job=job)
        # Step 3a: mark done & persist results into job.payload
        try:
            update_job(job_id, status="done", payload=result_payload, last_error="")
        except Exception as eud:
            _log(f"Job done but failed to persist results (id={job_id}): {eud}")
        return True, result_payload

    except Exception as e:
        err = f"{type(e).__name__}: {e}"
        _log(f"Handler crashed (id={job_id}): {err}\n{traceback.format_exc()}")
        # Step 3b: mark failed
        try:
            update_job(job_id, status="failed", last_error=err)
        except Exception as euf:
            _log(f"Also failed to mark job failed (id={job_id}): {euf}")
        return False, {"error": err}

def run_once(*, supported_jobs: Optional[Set[str]] = None, limit: Optional[int] = None) -> int:
    supported = supported_jobs or DEFAULT_SUPPORTED_JOBS
    try:
        jobs = fetch_jobs_to_run(limit=limit)
    except Exception as e:
        _log(f"Error fetching jobs: {e}")
        return 0

    if not jobs:
        _log("No jobs available.")
        return 0

    attempted = 0
    for job in jobs:
        if job.get("job_type") not in supported:
            continue
        attempted += 1
        _ = handle_job(job)

    return attempted

def run_forever(
    *,
    supported_jobs: Optional[Set[str]] = None,
    poll_limit: Optional[int] = 10,
    idle_sleep: Optional[float] = None,
) -> None:
    idle = SLEEP_IF_EMPTY if idle_sleep is None else idle_sleep
    _log(f"🚀 Worker started. Backend={BACKEND_URL} | supported={sorted(list(supported_jobs or DEFAULT_SUPPORTED_JOBS))}")
    _log("Transport: POST JSON to /api/worker/pick_up_job")

    while True:
        try:
            attempted = run_once(supported_jobs=supported_jobs, limit=poll_limit)
        except KeyboardInterrupt:
            _log("Shutting down (KeyboardInterrupt).")
            break
        except Exception as e:
            _log(f"run_once error: {e}")

        if attempted == 0:
            time.sleep(idle)

# ------------------------------ Module Exports ------------------------------

__all__ = [
    "post_onboard_evaluation",
    "run_once",
    "run_forever",
    "DEFAULT_SUPPORTED_JOBS",
]
