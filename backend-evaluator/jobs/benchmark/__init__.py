"""
jobs.benchmark

Benchmark framework: core models, providers, datasets, evaluations, reports, worker.
Avoid importing heavy modules here. Consumers should import submodules directly,
e.g. `from jobs.benchmark.reports.graphics import generate_benchmark_report`.
"""

__version__ = "0.1.0"

__all__ = ["core", "providers", "datasets", "evaluations", "reports", "worker"]
