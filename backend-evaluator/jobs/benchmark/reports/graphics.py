# reports/graphics.py
"""
Generate post-run plots for a completed benchmark/job_run.

Outputs under: reports/<BenchmarkID>/
  - run_info.json
  - metrics_summary.csv
  - ci_summary.csv
  - summary.csv                         (clean, combined, cross-run friendly)
  - wer_by_variant.png                  (bars with CI if present)
  - latency_p50_by_variant.png          (bars with CI if present)
  - latency_p95_by_variant.png          (bars with CI if present)
  - rtf_mean_by_variant.png             (bars with CI if present)
  - rtf_p95_by_variant.png              (bars with CI if present)
  - latency_hist_all.png                (hist of per-utterance total_time_ms)
  - rtf_hist_all.png                    (hist of RTF, excluding missing-duration rows)
"""
from __future__ import annotations

import os
import json
from typing import Dict, Any, Tuple, Optional, List

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt

from sqlalchemy.orm import Session as SASession
from sqlalchemy import create_engine

from ..core.models import (
    Dataset, DatasetVariant, JobRun, MetricSummary, BootstrapResult, LatencySample,
    Provider as ProviderTbl, Model as ModelTbl, Prediction, Utterance
)

# ------------- I/O helpers -------------

def _ensure_outdir(benchmark_id: str) -> str:
    outdir = os.path.join("reports", benchmark_id)
    os.makedirs(outdir, exist_ok=True)
    return outdir

def _load_context(session: SASession, job_run_id: int) -> dict:
    jr = session.get(JobRun, job_run_id)
    if not jr:
        raise ValueError(f"job_run_id {job_run_id} not found")
    prov = session.get(ProviderTbl, jr.provider_id)
    mod = session.get(ModelTbl, jr.model_id)
    return {
        "job_run_id": jr.job_run_id,
        "benchmark_id": jr.benchmark_id,
        "provider_id": jr.provider_id,
        "provider": getattr(prov, "name", None),
        "model_id": jr.model_id,
        "model": getattr(mod, "name", None),
        "eval_version": jr.eval_version,
        "status": jr.status,
        "started_at": jr.started_at.isoformat() if jr.started_at else None,
        "ended_at": jr.ended_at.isoformat() if jr.ended_at else None,
    }

def _collect_labels(session: SASession) -> Tuple[Dict[int, str], Dict[int, dict]]:
    ds_map = {d.dataset_id: d.name for d in session.query(Dataset).all()}
    var_map = {v.variant_id: v.variant_json for v in session.query(DatasetVariant).all()}
    return ds_map, var_map

def _variant_label(ds_name: str, vjson: dict | None) -> str:
    if not vjson:
        return f"{ds_name} [default]"
    parts = [f"{k}={v}" for k, v in sorted(vjson.items(), key=lambda kv: kv[0])]
    return f"{ds_name} [{', '.join(parts)}]"

# ------------- SQL → DataFrames -------------

def _metrics_wide(session: SASession, job_run_id: int) -> pd.DataFrame:
    rows = []
    ds_map, var_map = _collect_labels(session)
    for m in session.query(MetricSummary).filter_by(job_run_id=job_run_id).all():
        ds_name = ds_map.get(m.dataset_id, f"ds:{m.dataset_id}")
        vjson = var_map.get(m.variant_id)
        label = _variant_label(ds_name, vjson)
        rows.append({
            "label": label,
            "dataset_id": m.dataset_id,
            "variant_id": m.variant_id,
            "metric": m.metric,
            "value": m.value,
        })
    if not rows:
        return pd.DataFrame()
    df = pd.DataFrame(rows)
    wide = df.pivot_table(
        index=["label", "dataset_id", "variant_id"],
        columns="metric",
        values="value",
        aggfunc="first"
    ).reset_index()
    wide.columns = [c if isinstance(c, str) else c[1] for c in wide.columns]
    return wide

def _bootstrap_index(session: SASession, job_run_id: int) -> pd.DataFrame:
    """
    Returns a tidy DataFrame of all bootstrap CI rows for this run:
    columns: dataset_id, variant_id, metric, method, ci_low, ci_high, iterations, seed
    """
    rows = []
    for b in session.query(BootstrapResult).filter_by(job_run_id=job_run_id).all():
        rows.append({
            "dataset_id": b.dataset_id,
            "variant_id": b.variant_id,
            "metric": b.metric,
            "method": b.method,
            "ci_low": b.ci_low,
            "ci_high": b.ci_high,
            "iterations": b.iterations,
            "seed": b.seed,
        })
    return pd.DataFrame(rows)

def _latency_samples_df(session: SASession, job_run_id: int) -> pd.DataFrame:
    samples = session.query(LatencySample).filter_by(job_run_id=job_run_id).all()
    rows = []
    for s in samples:
        meta = s.meta_json or {}
        rows.append({
            "api_time_ms": s.api_time_ms,
            "total_time_ms": s.total_time_ms,
            "rtf": s.rtf,
            "rtf_missing": bool(meta.get("rtf_missing_duration")),
        })
    return pd.DataFrame(rows)

def _counts_by_variant(session: SASession, job_run_id: int) -> Dict[Tuple[int,int], int]:
    """
    Number of utterances evaluated per (dataset_id, variant_id) for this run.
    """
    rows = (
        session.query(Utterance.dataset_id, Utterance.variant_id)
        .join(Prediction, Prediction.utt_pk == Utterance.utt_pk)
        .filter(Prediction.job_run_id == job_run_id)
        .all()
    )
    c: Dict[Tuple[int,int], int] = {}
    for ds_id, var_id in rows:
        c[(int(ds_id), int(var_id))] = c.get((int(ds_id), int(var_id)), 0) + 1
    return c

# ------------- CI selection -------------

_METHOD_PRIORITY = [
    "bootstrap_percentile",        # preferred
    "orderstat_normal_approx",     # small-N fallback for quantiles
]

def _choose_ci(ci_df: pd.DataFrame, ds_id: int, var_id: int, metric: str) -> Optional[Tuple[float, float, str]]:
    """
    Pick the best CI for (dataset_id, variant_id, metric) using method priority,
    breaking ties by higher number of iterations.
    """
    if ci_df.empty:
        return None
    cands = ci_df[
        (ci_df.dataset_id == ds_id) &
        (ci_df.variant_id == var_id) &
        (ci_df.metric == metric)
    ]
    if cands.empty:
        return None

    def score(row):  # row is a namedtuple from itertuples()
        meth = getattr(row, "method", None)
        iters = getattr(row, "iterations", 0) or 0
        try:
            pri = _METHOD_PRIORITY.index(meth)
        except ValueError:
            pri = len(_METHOD_PRIORITY) + 1
        return (pri, -int(iters))  # lower is better

    best = min(cands.itertuples(index=False), key=score)
    return float(best.ci_low), float(best.ci_high), str(best.method)

def _build_yerr(series: pd.Series, wide_df: pd.DataFrame, ci_df: pd.DataFrame, metric: str) -> Optional[np.ndarray]:
    if series.empty:
        return None
    errs: List[float] = []
    any_found = False
    meta = wide_df.set_index("label")[["dataset_id", "variant_id"]]
    for label in series.index:
        ds_id, var_id = meta.loc[label, ["dataset_id", "variant_id"]]
        chosen = _choose_ci(ci_df, int(ds_id), int(var_id), metric)
        if chosen:
            lo, hi, _m = chosen
            center = float(series.loc[label])
            half = max(center - lo, hi - center)
            errs.append(half)
            any_found = True
        else:
            errs.append(0.0)
    return np.asarray(errs, dtype=float) if any_found else None

# ------------- Plotting -------------

def _plot_bar(values: pd.Series, title: str, ylabel: str, out_path: str, yerr: Optional[np.ndarray] = None):
    fig_w = min(max(8, 0.6 * max(1, len(values))), 18)
    plt.figure(figsize=(fig_w, 5))
    ax = values.plot(kind="bar", yerr=yerr, capsize=3)
    ax.set_title(title)
    ax.set_ylabel(ylabel)
    ax.set_xlabel("Dataset / Variant")
    ax.tick_params(axis="x", labelrotation=45)
    for lbl in ax.get_xticklabels():
        lbl.set_horizontalalignment("right")
    plt.tight_layout()
    plt.savefig(out_path, dpi=160)
    plt.close()

def _plot_hist(series: pd.Series, bins: int, title: str, xlabel: str, out_path: str):
    plt.figure(figsize=(8, 5))
    plt.hist(series.dropna().values, bins=bins)
    plt.title(title)
    plt.xlabel(xlabel)
    plt.ylabel("Count")
    plt.tight_layout()
    plt.savefig(out_path, dpi=160)
    plt.close()

# ------------- Public API -------------

def generate_benchmark_report(
    db_url: str,
    benchmark_id: str,
    job_run_id: Optional[int] = None,
) -> Dict[str, Any]:
    """
    Generate plots & CSVs for the latest (or provided) completed job_run of a benchmark.
    """
    engine = create_engine(db_url, future=True)
    out: Dict[str, Any] = {}
    outdir = _ensure_outdir(benchmark_id)

    with SASession(engine) as s:
        # choose run
        if job_run_id is None:
            jr = (
                s.query(JobRun)
                .filter_by(benchmark_id=benchmark_id, status="completed")
                .order_by(JobRun.job_run_id.desc())
                .first()
            )
            if not jr:
                raise RuntimeError(f"No completed job_run found for benchmark_id={benchmark_id}")
            job_run_id = jr.job_run_id

        # save context
        ctx = _load_context(s, job_run_id)
        out["run_info_json"] = os.path.join(outdir, "run_info.json")
        with open(out["run_info_json"], "w", encoding="utf-8") as f:
            json.dump(ctx, f, indent=2)

        # load data
        wide = _metrics_wide(s, job_run_id)
        if wide.empty:
            raise RuntimeError("No MetricSummary rows found; evaluation may not have produced summaries.")
        ci_df = _bootstrap_index(s, job_run_id)
        counts = _counts_by_variant(s, job_run_id)

        # save raw metrics
        out["metrics_summary_csv"] = os.path.join(outdir, "metrics_summary.csv")
        wide.to_csv(out["metrics_summary_csv"], index=False, encoding="utf-8")

        # save CI summary (best method chosen per metric/variant)
        ci_rows = []
        for _, row in wide.iterrows():
            ds_id, var_id = int(row["dataset_id"]), int(row["variant_id"])
            for metric in ["wer", "latency_p50_ms", "latency_p95_ms", "rtf_mean", "rtf_p95", "wer_sentence_proxy"]:
                chosen = _choose_ci(ci_df, ds_id, var_id, metric)
                if chosen:
                    lo, hi, method = chosen
                    ci_rows.append({
                        "dataset_id": ds_id,
                        "variant_id": var_id,
                        "metric": metric,
                        "ci_low": lo,
                        "ci_high": hi,
                        "method": method,
                    })
        ci_tbl = pd.DataFrame(ci_rows)
        out["ci_summary_csv"] = os.path.join(outdir, "ci_summary.csv")
        ci_tbl.to_csv(out["ci_summary_csv"], index=False, encoding="utf-8")

        # ---------- NEW: combined summary.csv ----------
        # Build a tidy, comparison-ready table with point estimates + chosen CI
        def _chosen_ci(ds_id: int, var_id: int, metric: str) -> Tuple[Optional[float], Optional[float]]:
            c = _choose_ci(ci_df, ds_id, var_id, metric)
            return (c[0], c[1]) if c else (None, None)

        summary_rows = []
        for _, row in wide.iterrows():
            ds_id, var_id, label = int(row["dataset_id"]), int(row["variant_id"]), row["label"]
            n = counts.get((ds_id, var_id), None)

            wer = row.get("wer", None)
            wer_lo, wer_hi = _chosen_ci(ds_id, var_id, "wer")

            lp50 = row.get("latency_p50_ms", None)
            lp50_lo, lp50_hi = _chosen_ci(ds_id, var_id, "latency_p50_ms")

            lp95 = row.get("latency_p95_ms", None)
            lp95_lo, lp95_hi = _chosen_ci(ds_id, var_id, "latency_p95_ms")

            rtfm = row.get("rtf_mean", None)
            rtfm_lo, rtfm_hi = _chosen_ci(ds_id, var_id, "rtf_mean")

            rtfp = row.get("rtf_p95", None)
            rtfp_lo, rtfp_hi = _chosen_ci(ds_id, var_id, "rtf_p95")

            summary_rows.append({
                "benchmark_id": ctx["benchmark_id"],
                "job_run_id": ctx["job_run_id"],
                "provider": ctx.get("provider"),
                "model": ctx.get("model"),
                "eval_version": ctx.get("eval_version"),

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

        summary_df = pd.DataFrame(summary_rows)
        out["summary_csv"] = os.path.join(outdir, "summary.csv")
        summary_df.to_csv(out["summary_csv"], index=False, encoding="utf-8")

        # ---------- Plots ----------
        if "wer" in wide.columns:
            wer_series = wide.set_index("label")["wer"].sort_index()
            yerr = _build_yerr(wer_series, wide, ci_df, metric="wer")
            if yerr is None:
                proxy_yerr = _build_yerr(wer_series, wide, ci_df, metric="wer_sentence_proxy")
                yerr = proxy_yerr
            out["wer_png"] = os.path.join(outdir, "wer_by_variant.png")
            _plot_bar(wer_series, "WER by Dataset/Variant", "WER", out["wer_png"], yerr=yerr)

        lat_idx = wide.set_index("label")
        if "latency_p50_ms" in lat_idx.columns:
            s50 = lat_idx["latency_p50_ms"].sort_index()
            yerr50 = _build_yerr(s50, wide, ci_df, metric="latency_p50_ms")
            out["latency_p50_png"] = os.path.join(outdir, "latency_p50_by_variant.png")
            _plot_bar(s50, "Latency P50 by Dataset/Variant", "Milliseconds", out["latency_p50_png"], yerr=yerr50)

        if "latency_p95_ms" in lat_idx.columns:
            s95 = lat_idx["latency_p95_ms"].sort_index()
            yerr95 = _build_yerr(s95, wide, ci_df, metric="latency_p95_ms")
            out["latency_p95_png"] = os.path.join(outdir, "latency_p95_by_variant.png")
            _plot_bar(s95, "Latency P95 by Dataset/Variant", "Milliseconds", out["latency_p95_png"], yerr=yerr95)

        if "rtf_mean" in lat_idx.columns:
            rtf_mean = lat_idx["rtf_mean"].sort_index()
            yerr_rm = _build_yerr(rtf_mean, wide, ci_df, metric="rtf_mean")
            out["rtf_mean_png"] = os.path.join(outdir, "rtf_mean_by_variant.png")
            _plot_bar(rtf_mean, "RTF (mean) by Dataset/Variant", "RTF", out["rtf_mean_png"], yerr=yerr_rm)

        if "rtf_p95" in lat_idx.columns:
            rtf_p95 = lat_idx["rtf_p95"].sort_index()
            yerr_rp = _build_yerr(rtf_p95, wide, ci_df, metric="rtf_p95")
            out["rtf_p95_png"] = os.path.join(outdir, "rtf_p95_by_variant.png")
            _plot_bar(rtf_p95, "RTF (p95) by Dataset/Variant", "RTF", out["rtf_p95_png"], yerr=yerr_rp)

        samples = _latency_samples_df(s, job_run_id)
        if not samples.empty:
            out["latency_hist_png"] = os.path.join(outdir, "latency_hist_all.png")
            _plot_hist(samples["total_time_ms"], bins=50,
                       title="Latency Histogram (all utterances)",
                       xlabel="Total time (ms)", out_path=out["latency_hist_png"])

            rtf_series = samples.loc[~samples["rtf_missing"], "rtf"]
            if rtf_series.notna().any():
                out["rtf_hist_png"] = os.path.join(outdir, "rtf_hist_all.png")
                _plot_hist(rtf_series, bins=50,
                           title="RTF Histogram (all utterances)",
                           xlabel="RTF", out_path=out["rtf_hist_png"])

    return out
