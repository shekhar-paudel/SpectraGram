"""
jobs.benchmark.evaluations

Evaluation pipelines. Importing this package ensures pipeline registration
side-effects are executed (e.g., providers/datasets register themselves).
"""

# Import the versioned package so its __init__ runs and pulls in `pipeline`.
from . import v1 as _v1  # noqa: F401

__all__ = ["v1"]
