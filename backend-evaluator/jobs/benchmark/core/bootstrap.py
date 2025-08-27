# core/bootstrap.py
import numpy as np
from typing import Tuple

# jobs/benchmark/core/bootstrap.py
import os
from urllib.parse import urlparse
from sqlalchemy import create_engine
from jobs.benchmark.core.models import (
    Dataset, DatasetVariant, JobRun, MetricSummary as CoreMetricSummary,
    BootstrapResult, Provider, Model, Prediction, Utterance
)

def _ensure_sqlite_dir(db_url: str) -> None:
    if db_url.startswith("sqlite:///"):
        path = db_url.replace("sqlite:///", "", 1)
        d = os.path.dirname(path)
        if d and not os.path.exists(d):
            os.makedirs(d, exist_ok=True)

def ensure_benchmark_schema(db_url: str) -> None:
    """
    Idempotently creates the benchmark tables for the given db_url.
    Works for SQLite/Postgres/MySQL without Flask.
    """
    _ensure_sqlite_dir(db_url)
    engine = create_engine(db_url, future=True)

    # Create each table with checkfirst=True to avoid needing Base/metadata
    for tbl in [
        Dataset.__table__,
        DatasetVariant.__table__,
        JobRun.__table__,
        CoreMetricSummary.__table__,
        BootstrapResult.__table__,
        Provider.__table__,
        Model.__table__,
        Prediction.__table__,
        Utterance.__table__,
    ]:
        tbl.create(bind=engine, checkfirst=True)

    engine.dispose()


def bootstrap_ci(values: np.ndarray, iterations=1000, conf=0.95, seed=42) -> Tuple[float,float]:
    rng = np.random.default_rng(seed)
    n = len(values)
    boots = np.empty(iterations)
    for i in range(iterations):
        idx = rng.integers(0, n, n)
        boots[i] = np.mean(values[idx])
    alpha = (1.0 - conf) / 2.0
    return (float(np.quantile(boots, alpha)), float(np.quantile(boots, 1.0 - alpha)))
