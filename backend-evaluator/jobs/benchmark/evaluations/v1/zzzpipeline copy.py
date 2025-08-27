# evaluations/v1/pipeline.py
from core.registry import EVAL_REGISTRY, RunContext
from core.models import Prediction, Utterance, Dataset, DatasetVariant, MetricSummary, BootstrapResult, LatencySample
from core.normalize import build_norm_pipeline
from core.metrics import compute_wer, latency_summary
from core.bootstrap import bootstrap_ci
import numpy as np

class EvaluationV1:
    version = "v1"

    # Policy (owned here, not in JSON)
    DEFAULT_TEXT_NORM = dict(lowercase=True, remove_punct=True, remove_numbers=False, collapse_whitespace=True)
    BOOTSTRAP = dict(iterations=1000, confidence=0.95)
    INFERENCE = dict(concurrency=4, rps=2.0, timeout_s=120)  # provider-agnostic defaults
    # Dataset subset policy: for librispeech, we expect clean + SNR + tel8k (set in loader).
    # For other datasets, use their default loader behavior.

    def inference_profile(self):  # runner will read this
        return self.INFERENCE

    def run(self, run_ctx: RunContext) -> None:
        norm = build_norm_pipeline(type("T", (), self.DEFAULT_TEXT_NORM)())
        cfg = run_ctx.cfg

        with run_ctx.session_factory() as s:
            pairs = s.query(Prediction, Utterance, Dataset, DatasetVariant, LatencySample)\
                .join(Utterance, Prediction.utt_pk == Utterance.utt_pk)\
                .join(Dataset, Utterance.dataset_id == Dataset.dataset_id)\
                .join(DatasetVariant, Utterance.variant_id == DatasetVariant.variant_id)\
                .join(LatencySample, (LatencySample.job_run_id == Prediction.job_run_id) & (LatencySample.utt_pk == Prediction.utt_pk))\
                .filter(Prediction.job_run_id == run_ctx.job_run_id).all()

            buckets = {}
            for pred, utt, ds, var, lat in pairs:
                key = (ds.dataset_id, var.variant_id)
                buckets.setdefault(key, {"refs": [], "hyps": [], "lat_ms": [], "dur_s": []})
                buckets[key]["refs"].append(utt.ref_text)
                buckets[key]["hyps"].append(pred.hyp_text)
                buckets[key]["lat_ms"].append(lat.total_time_ms)
                buckets[key]["dur_s"].append(utt.duration_s if utt.duration_s is not None else np.nan)

            for (ds_id, var_id), data in buckets.items():
                refs_n = [norm(r) for r in data["refs"]]
                hyps_n = [norm(h) for h in data["hyps"]]
                w = compute_wer(refs_n, hyps_n)
                lat_stats = latency_summary(data["lat_ms"], data["dur_s"])

                s.add(MetricSummary(job_run_id=run_ctx.job_run_id, dataset_id=ds_id, variant_id=var_id, metric="wer", value=float(w)))
                for k, v in lat_stats.items():
                    s.add(MetricSummary(job_run_id=run_ctx.job_run_id, dataset_id=ds_id, variant_id=var_id, metric=k, value=float(v)))

                # Per-utterance sentence-level proxy for CI (fast path)
                errs = np.array([0.0 if r == h else 1.0 for r, h in zip(refs_n, hyps_n)], dtype=float)
                if errs.size >= 5:
                    lo, hi = bootstrap_ci(errs, iterations=self.BOOTSTRAP["iterations"], conf=self.BOOTSTRAP["confidence"], seed=42)
                    s.add(BootstrapResult(job_run_id=run_ctx.job_run_id, dataset_id=ds_id, variant_id=var_id,
                                          metric="wer_sentence_proxy", ci_low=lo, ci_high=hi,
                                          iterations=self.BOOTSTRAP["iterations"], method="bootstrap_simple", seed=42))
            s.commit()

EVAL_REGISTRY["v1"] = EvaluationV1()
