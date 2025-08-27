# jobs\post_onboard.py
from __future__ import annotations
import os, json, pathlib
from typing import Optional, Dict, Any

from jobs.benchmark.worker.runner import post_onboard_evaluation
from jobs.benchmark.core.bootstrap import ensure_benchmark_schema  # <-- NEW
try:
    from jobs.benchmark.reports.graphics import generate_benchmark_report  # optional
except Exception:
    generate_benchmark_report = None

BASE_DIR = pathlib.Path(__file__).resolve().parents[1]  # backend-evaluator/
DEFAULT_DB_URL = os.getenv(
    "SPECTRAGRAM_DB_URL",
    f"sqlite:///{BASE_DIR.joinpath('instance', 'spectragram.db')}"
)

# Worker default for reports (hardcoded here)
DEFAULT_REPORTS_DIR = os.getenv(
    "SPECTRAGRAM_REPORTS_DIR",
    str(BASE_DIR / "instance" / "reports")
)

def _resolve_config_path(p: str | os.PathLike) -> pathlib.Path:
    """Resolve a config path relative to common roots."""
    cand = pathlib.Path(p)
    if cand.is_absolute() and cand.exists():
        return cand
    # try relative to CWD
    if pathlib.Path.cwd().joinpath(cand).exists():
        return pathlib.Path.cwd().joinpath(cand)
    # try relative to project root
    root = BASE_DIR
    for maybe in (
        root / cand,
        root / "jobs" / "benchmark" / cand,
        root / "jobs" / cand,
    ):
        if maybe.exists():
            return maybe
    # last resort: return as-is (will raise on open)
    return cand
def run_benchmark_from_dict(
    config_dict: Dict[str, Any],
    *,
    max_per_subset: Optional[int] = None,
    db_url: Optional[str] = None,
) -> Dict[str, Any]:
    if max_per_subset is not None:
        os.environ["SB_MAX_PER_SUBSET"] = str(max_per_subset)

    # pick a single db_url and use it everywhere
    db_url = db_url or DEFAULT_DB_URL

    # ✅ Make sure schema exists for this db_url (works for SQLite/Postgres/MySQL)
    ensure_benchmark_schema(db_url)

    os.makedirs(DEFAULT_REPORTS_DIR, exist_ok=True)

    cfg_json = json.dumps(config_dict)

    # ✅ Pass the same db_url to the writer
    result = post_onboard_evaluation(cfg_json, db_url=db_url)

    # Generate static artifacts if the optional reporter is available
    if result and result.get("status") in ("completed", "already_completed") and callable(generate_benchmark_report):
        try:
            generate_benchmark_report(db_url, result["benchmark_id"], job_run_id=result["job_run_id"])
        except Exception as e:
            print(f"[report] failed to generate: {e}")
    return result
    
def run_benchmark_from_config(
    config_path: str | os.PathLike,
    *,
    max_per_subset: Optional[int] = None,
    db_url: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Load a JSON config file and delegate to run_benchmark_from_dict.
    Matches `python app.py --config jobs/deepgram_librispeech.json --max-per-subset 10`.
    """
    path = _resolve_config_path(config_path)
    with open(path, "r", encoding="utf-8") as f:
        cfg = json.load(f)
    return run_benchmark_from_dict(cfg, max_per_subset=max_per_subset, db_url=db_url)
