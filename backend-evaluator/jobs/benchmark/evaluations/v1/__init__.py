"""
jobs.benchmark.evaluations.v1

Versioned evaluation pipeline. Import the pipeline module to execute any
registration side-effects with registries used by the worker.
"""

from . import pipeline  # noqa: F401

__all__ = ["pipeline"]
