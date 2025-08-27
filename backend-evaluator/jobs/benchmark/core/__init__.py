"""
jobs.benchmark.core

Core primitives: ORM models, config/schema, registry, metrics, bootstrap, etc.
Do not auto-import heavy modules to keep import time small.
"""

# Re-export common types only if you want (optional). Otherwise leave empty.
# Example (commented to avoid eager imports):
# from .models import Base  # noqa: F401
# __all__ = ["Base"]
