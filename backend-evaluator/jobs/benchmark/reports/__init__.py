"""
jobs.benchmark.reports

Reporting utilities (CSV summaries, plots).
Export the primary helper for convenience.
"""

from .graphics import generate_benchmark_report  # noqa: F401

__all__ = ["generate_benchmark_report"]
