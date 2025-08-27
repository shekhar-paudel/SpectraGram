# jobs\benchmark\evaluations\v1\pipeline.py
from __future__ import annotations

from dataclasses import dataclass
from typing import List, Tuple, Dict, Optional

import numpy as np

from jobs.benchmark.core.registry import EVAL_REGISTRY, RunContext
from jobs.benchmark.core.models import (
    Prediction, Utterance, Dataset, DatasetVariant,
    MetricSummary, BootstrapResult, LatencySample
)
from jobs.benchmark.core.normalize import build_norm_pipeline


# -----------------------
# Utility: word-level S/D/I via DP (corpus-accurate WER)
# -----------------------
def _tokenize(s: str) -> List[str]:
    # after normalization, whitespace split is fine
    return s.split()


def _edit_counts(ref_words: List[str], hyp_words: List[str]) -> Tuple[int, int, int]:
    """
    Return (S, D, I) counts using classic DP with backtrack.
    """
    n, m = len(ref_words), len(hyp_words)
    # cost matrix
    cost = np.zeros((n + 1, m + 1), dtype=np.int32)
    # 0=diag, 1=up(del), 2=left(ins)
    back = np.zeros((n + 1, m + 1), dtype=np.uint8)

    # init borders
    for i in range(1, n + 1):
        cost[i, 0] = i
        back[i, 0] = 1  # deletions
    for j in range(1, m + 1):
        cost[0, j] = j
        back[0, j] = 2  # insertions

    # fill
    for i in range(1, n + 1):
        rw = ref_words[i - 1]
        for j in range(1, m + 1):
            hw = hyp_words[j - 1]
            if rw == hw:
                cost[i, j] = cost[i - 1, j - 1]
                back[i, j] = 0
            else:
                # sub, del, ins (+1 each)
                sub = cost[i - 1, j - 1] + 1
                dele = cost[i - 1, j] + 1
                ins = cost[i, j - 1] + 1
                cmin = sub
                b = 0
                if dele < cmin:
                    cmin = dele
                    b = 1
                if ins < cmin:
                    cmin = ins
                    b = 2
                cost[i, j] = cmin
                back[i, j] = b

    # backtrack to count S/D/I
    i, j = n, m
    S = D = I = 0
    while i > 0 or j > 0:
        b = back[i, j]
        if b == 0:
            # diag: match or substitution
            if i > 0 and j > 0 and ref_words[i - 1] != hyp_words[j - 1]:
                S += 1
            i -= 1 if i > 0 else 0
            j -= 1 if j > 0 else 0
        elif b == 1:
            # up: deletion
            D += 1
            i -= 1
        else:
            # left: insertion
            I += 1
            j -= 1
    return S, D, I


# -----------------------
# Bootstrap helpers
# -----------------------
def _bootstrap_ci_from_values(vals: np.ndarray, stat_fn, iterations=1000, conf=0.95, seed=42) -> Tuple[float, float]:
    """
    Generic percentile bootstrap CI for a statistic over 1D sample `vals`.
    """
    rng = np.random.default_rng(seed)
    n = len(vals)
    if n == 0:
        raise ValueError("bootstrap on empty array")
    stats = np.empty(iterations, dtype=float)
    for b in range(iterations):
        idx = rng.integers(0, n, size=n)
        stats[b] = stat_fn(vals[idx])
    alpha = 1.0 - conf
    lo = float(np.quantile(stats, alpha / 2))
    hi = float(np.quantile(stats, 1 - alpha / 2))
    return lo, hi


def _bootstrap_ci_quantile(vals: np.ndarray, q: float, iterations=1000, conf=0.95, seed=42) -> Tuple[float, float]:
    """
    Percentile bootstrap CI for a quantile q.
    """
    return _bootstrap_ci_from_values(vals, lambda x: np.quantile(x, q), iterations, conf, seed)


def _orderstat_ci_quantile_normal(vals_sorted: np.ndarray, q: float, conf=0.95) -> Tuple[float, float]:
    """
    Approximate, distribution-free CI for a quantile using normal approximation
    to the Binomial(n, q) for order statistic ranks.
    """
    from math import sqrt
    n = len(vals_sorted)
    if n == 0:
        raise ValueError("orderstat CI on empty array")
    # z for two-sided
    from math import erf, sqrt as _sqrt
    def _z(p):
        # inverse CDF for standard normal via approximation (sufficient for CI rank calc)
        # use scipy if available; otherwise a rational approximation:
        # https://stackoverflow.com/a/45170606 (Beasley-Springer/Moro variants)
        # Here: simple bisection on erf for robustness.
        lo, hi = -8.0, 8.0
        for _ in range(60):
            mid = (lo + hi) / 2
            if 0.5 * (1 + erf(mid / _sqrt(2))) < p:
                lo = mid
            else:
                hi = mid
        return (lo + hi) / 2

    alpha = 1.0 - conf
    z = _z(1 - alpha / 2)
    mu = n * q
    sigma = sqrt(n * q * (1 - q)) + 1e-9
    k_lo = int(max(1, np.floor(mu - z * sigma)))
    k_hi = int(min(n, np.ceil(mu + z * sigma)))
    # map ranks to values
    return float(vals_sorted[k_lo - 1]), float(vals_sorted[k_hi - 1])


# -----------------------
# Evaluation V1
# -----------------------
class EvaluationV1:
    version = "v1"

    # Policy owned here
    DEFAULT_TEXT_NORM = dict(lowercase=True, remove_punct=True, remove_numbers=False, collapse_whitespace=True)
    BOOTSTRAP = dict(iterations=1000, confidence=0.95, seed=42)
    INFERENCE = dict(concurrency=4, rps=2.0, timeout_s=120)

    def inference_profile(self):
        return self.INFERENCE

    def run(self, run_ctx: RunContext) -> None:
        cfg = run_ctx.cfg
        norm = build_norm_pipeline(type("T", (), self.DEFAULT_TEXT_NORM)())

        B = self.BOOTSTRAP["iterations"]
        CONF = self.BOOTSTRAP["confidence"]
        SEED = self.BOOTSTRAP["seed"]

        with run_ctx.session_factory() as s:
            # Join predictions to utterances/datasets/variants + latency samples
            pairs = (
                s.query(Prediction, Utterance, Dataset, DatasetVariant, LatencySample)
                .join(Utterance, Prediction.utt_pk == Utterance.utt_pk)
                .join(Dataset, Utterance.dataset_id == Dataset.dataset_id)
                .join(DatasetVariant, Utterance.variant_id == DatasetVariant.variant_id)
                .join(LatencySample, (LatencySample.job_run_id == Prediction.job_run_id) & (LatencySample.utt_pk == Prediction.utt_pk))
                .filter(Prediction.job_run_id == run_ctx.job_run_id)
                .all()
            )

            # Bucket by dataset/variant
            buckets: Dict[Tuple[int, int], Dict[str, list]] = {}
            for pred, utt, ds, var, lat in pairs:
                key = (ds.dataset_id, var.variant_id)
                b = buckets.setdefault(key, {"refs": [], "hyps": [], "lat_ms": [], "dur_s": []})
                b["refs"].append(utt.ref_text)
                b["hyps"].append(pred.hyp_text)
                b["lat_ms"].append(float(lat.total_time_ms))
                b["dur_s"].append(float(utt.duration_s) if utt.duration_s is not None and utt.duration_s > 0 else np.nan)

            # Compute metrics + CIs
            for (ds_id, var_id), data in buckets.items():
                # Normalize text
                refs_n = [norm(r) for r in data["refs"]]
                hyps_n = [norm(h) for h in data["hyps"]]

                # ----- Exact corpus WER -----
                S = D = I = N = 0
                for r, h in zip(refs_n, hyps_n):
                    rw = _tokenize(r); hw = _tokenize(h)
                    s1, d1, i1 = _edit_counts(rw, hw)
                    S += s1; D += d1; I += i1; N += len(rw)
                wer_point = (S + D + I) / max(1, N)

                # Save point metric
                s.add(MetricSummary(job_run_id=run_ctx.job_run_id, dataset_id=ds_id, variant_id=var_id,
                                    metric="wer", value=float(wer_point)))

                # Bootstrap CI for WER (percentile)
                idx_vals = np.arange(len(refs_n))
                rng = np.random.default_rng(SEED)
                wer_boot = np.empty(B, dtype=float)
                for b in range(B):
                    idx = rng.integers(0, len(idx_vals), size=len(idx_vals))
                    Sb = Db = Ib = Nb = 0
                    for k in idx:
                        rw = _tokenize(refs_n[k]); hw = _tokenize(hyps_n[k])
                        s1, d1, i1 = _edit_counts(rw, hw)
                        Sb += s1; Db += d1; Ib += i1; Nb += len(rw)
                    wer_boot[b] = (Sb + Db + Ib) / max(1, Nb)
                alpha = 1 - CONF
                wer_lo = float(np.quantile(wer_boot, alpha / 2))
                wer_hi = float(np.quantile(wer_boot, 1 - alpha / 2))
                s.add(BootstrapResult(job_run_id=run_ctx.job_run_id, dataset_id=ds_id, variant_id=var_id,
                                      metric="wer", ci_low=wer_lo, ci_high=wer_hi,
                                      iterations=B, method="bootstrap_percentile", seed=SEED))

                # (Optional) sentence-level proxy, for continuity with older reports
                sent_err = np.array([0.0 if r == h else 1.0 for r, h in zip(refs_n, hyps_n)], dtype=float)
                if sent_err.size >= 5:
                    lo_p, hi_p = _bootstrap_ci_from_values(sent_err, np.mean, iterations=B, conf=CONF, seed=SEED)
                    s.add(BootstrapResult(job_run_id=run_ctx.job_run_id, dataset_id=ds_id, variant_id=var_id,
                                          metric="wer_sentence_proxy", ci_low=lo_p, ci_high=hi_p,
                                          iterations=B, method="bootstrap_percentile", seed=SEED))

                # ----- Latency (ms) -----
                lat = np.asarray(data["lat_ms"], dtype=float)
                # Point estimates
                lat_p50 = float(np.quantile(lat, 0.5))
                lat_p95 = float(np.quantile(lat, 0.95))
                s.add(MetricSummary(job_run_id=run_ctx.job_run_id, dataset_id=ds_id, variant_id=var_id,
                                    metric="latency_p50_ms", value=lat_p50))
                s.add(MetricSummary(job_run_id=run_ctx.job_run_id, dataset_id=ds_id, variant_id=var_id,
                                    metric="latency_p95_ms", value=lat_p95))
                # CIs via bootstrap
                try:
                    lo, hi = _bootstrap_ci_quantile(lat, 0.5, iterations=B, conf=CONF, seed=SEED)
                    s.add(BootstrapResult(job_run_id=run_ctx.job_run_id, dataset_id=ds_id, variant_id=var_id,
                                          metric="latency_p50_ms", ci_low=lo, ci_high=hi,
                                          iterations=B, method="bootstrap_percentile", seed=SEED))
                    lo, hi = _bootstrap_ci_quantile(lat, 0.95, iterations=B, conf=CONF, seed=SEED)
                    s.add(BootstrapResult(job_run_id=run_ctx.job_run_id, dataset_id=ds_id, variant_id=var_id,
                                          metric="latency_p95_ms", ci_low=lo, ci_high=hi,
                                          iterations=B, method="bootstrap_percentile", seed=SEED))
                except ValueError:
                    pass  # empty edge case

                # For small N, also add order-stat normal-approx CIs for quantiles
                if lat.size > 0 and lat.size < 300:
                    slat = np.sort(lat)
                    lo, hi = _orderstat_ci_quantile_normal(slat, 0.5, conf=CONF)
                    s.add(BootstrapResult(job_run_id=run_ctx.job_run_id, dataset_id=ds_id, variant_id=var_id,
                                          metric="latency_p50_ms", ci_low=lo, ci_high=hi,
                                          iterations=0, method="orderstat_normal_approx", seed=None))
                    lo, hi = _orderstat_ci_quantile_normal(slat, 0.95, conf=CONF)
                    s.add(BootstrapResult(job_run_id=run_ctx.job_run_id, dataset_id=ds_id, variant_id=var_id,
                                          metric="latency_p95_ms", ci_low=lo, ci_high=hi,
                                          iterations=0, method="orderstat_normal_approx", seed=None))

                # ----- RTF (exclude missing durations) -----
                dur = np.asarray(data["dur_s"], dtype=float)
                mask = np.isfinite(dur) & (dur > 0)
                if np.any(mask):
                    rtf = (lat[mask] / 1000.0) / dur[mask]
                    rtf_mean = float(np.mean(rtf))
                    rtf_p95 = float(np.quantile(rtf, 0.95))
                    s.add(MetricSummary(job_run_id=run_ctx.job_run_id, dataset_id=ds_id, variant_id=var_id,
                                        metric="rtf_mean", value=rtf_mean))
                    s.add(MetricSummary(job_run_id=run_ctx.job_run_id, dataset_id=ds_id, variant_id=var_id,
                                        metric="rtf_p95", value=rtf_p95))
                    # CIs
                    lo, hi = _bootstrap_ci_from_values(rtf, np.mean, iterations=B, conf=CONF, seed=SEED)
                    s.add(BootstrapResult(job_run_id=run_ctx.job_run_id, dataset_id=ds_id, variant_id=var_id,
                                          metric="rtf_mean", ci_low=lo, ci_high=hi,
                                          iterations=B, method="bootstrap_percentile", seed=SEED))
                    lo, hi = _bootstrap_ci_quantile(rtf, 0.95, iterations=B, conf=CONF, seed=SEED)
                    s.add(BootstrapResult(job_run_id=run_ctx.job_run_id, dataset_id=ds_id, variant_id=var_id,
                                          metric="rtf_p95", ci_low=lo, ci_high=hi,
                                          iterations=B, method="bootstrap_percentile", seed=SEED))
                    # small-N quantile CI for rtf p95
                    if rtf.size < 300 and rtf.size > 0:
                        srtf = np.sort(rtf)
                        lo, hi = _orderstat_ci_quantile_normal(srtf, 0.95, conf=CONF)
                        s.add(BootstrapResult(job_run_id=run_ctx.job_run_id, dataset_id=ds_id, variant_id=var_id,
                                              metric="rtf_p95", ci_low=lo, ci_high=hi,
                                              iterations=0, method="orderstat_normal_approx", seed=None))

            s.commit()


# register
EVAL_REGISTRY["v1"] = EvaluationV1()
