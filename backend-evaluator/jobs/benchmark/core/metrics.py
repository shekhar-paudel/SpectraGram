# core/metrics.py
import numpy as np
from jiwer import wer

def compute_wer(refs, hyps):
    return wer(refs, hyps)

def percentile(xs, p):
    return float(np.percentile(np.asarray(xs, dtype=float), p))

def latency_summary(total_ms_list, durations_s_list):
    total_ms = np.asarray(total_ms_list, dtype=float)
    out = {
        "latency_p50_ms": percentile(total_ms, 50),
        "latency_p95_ms": percentile(total_ms, 95),
    }
    # RTF only if durations are available and positive
    if durations_s_list and any(d and d > 0 for d in durations_s_list):
        dur = np.asarray([d if (d and d > 0) else np.nan for d in durations_s_list], dtype=float)
        rtf = total_ms / (dur * 1000.0)
        rtf = rtf[~np.isnan(rtf)]
        if rtf.size:
            out["rtf_mean"] = float(np.mean(rtf))
            out["rtf_p95"] = percentile(rtf, 95)
    return out
