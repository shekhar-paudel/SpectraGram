"""
jobs package

Holds background-job entrypoints and utilities (e.g., post_onboard, benchmark).
Keep this lightweight to avoid import-time side effects in workers.
"""

__all__ = ["benchmark"]
