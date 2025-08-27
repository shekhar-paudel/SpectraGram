# models.py (or wherever ModelInventory / JobQueue live)

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional, Any, Dict

from app.database import db

# --- ModelInventory ---

class ModelInventory(db.Model):
    __tablename__ = "model_inventory"

    id = db.Column(db.String(255), primary_key=True)
    data = db.Column(db.JSON, nullable=False, default=dict)

    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    jobs = db.relationship(
        "JobQueue",
        back_populates="model",
        primaryjoin="ModelInventory.id == JobQueue.model_id",
        lazy="dynamic",
        cascade="all, delete-orphan",
    )

    # RENAMED back_populates target to "model_inventory"
    # Also drop delete-orphan here to avoid multi-parent orphaning conflicts
    metric_summaries = db.relationship(
        "MetricSummary",
        back_populates="model_inventory",
        primaryjoin="ModelInventory.id == MetricSummary.model_id",
        lazy="dynamic",
        cascade="all",  # no delete-orphan here
    )

# --- MetricSummary ---

class MetricSummary(db.Model):
    __tablename__ = "metric_summary"

    id = db.Column(db.Integer, primary_key=True)

    # joins
    job_id = db.Column(db.String(36), db.ForeignKey("job_queue.id"), nullable=False, index=True)
    model_id = db.Column(db.String(255), db.ForeignKey("model_inventory.id"), nullable=True, index=True)

    # identity of run
    benchmark_id = db.Column(db.String(255), nullable=True, index=True)
    job_run_id = db.Column(db.Integer, nullable=True, index=True)

    # descriptive
    provider = db.Column(db.String(128), nullable=True)
    model = db.Column(db.String(128), nullable=True)  # stays as STRING COLUMN
    eval_version = db.Column(db.String(64), nullable=True)
    label = db.Column(db.String(512), nullable=True)

    # dataset / variant
    dataset_id = db.Column(db.Integer, nullable=True, index=True)
    dataset_name = db.Column(db.String(128), nullable=True, index=True)
    variant_id = db.Column(db.Integer, nullable=True, index=True)
    n_utterances = db.Column(db.Integer, nullable=True)

    # metrics + CIs
    wer = db.Column(db.Float, nullable=True)
    wer_ci_low = db.Column(db.Float, nullable=True)
    wer_ci_high = db.Column(db.Float, nullable=True)

    latency_p50_ms = db.Column(db.Float, nullable=True)
    latency_p50_ms_ci_low = db.Column(db.Float, nullable=True)
    latency_p50_ms_ci_high = db.Column(db.Float, nullable=True)

    latency_p95_ms = db.Column(db.Float, nullable=True)
    latency_p95_ms_ci_low = db.Column(db.Float, nullable=True)
    latency_p95_ms_ci_high = db.Column(db.Float, nullable=True)

    rtf_mean = db.Column(db.Float, nullable=True)
    rtf_mean_ci_low = db.Column(db.Float, nullable=True)
    rtf_mean_ci_high = db.Column(db.Float, nullable=True)

    rtf_p95 = db.Column(db.Float, nullable=True)
    rtf_p95_ci_low = db.Column(db.Float, nullable=True)
    rtf_p95_ci_high = db.Column(db.Float, nullable=True)

    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)

    # relationships
    job = db.relationship("JobQueue", back_populates="metric_summaries")
    # RENAMED: was "model" (collided with column). Now "model_inventory".
    model_inventory = db.relationship("ModelInventory", back_populates="metric_summaries")


class JobQueue(db.Model):
    __tablename__ = "job_queue"
    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    model_id = db.Column(db.String(255), db.ForeignKey("model_inventory.id"), nullable=True, index=True)

    job_type = db.Column(db.String(64), nullable=False, index=True)
    status = db.Column(db.String(32), nullable=False, default="queued", index=True)
    priority = db.Column(db.Integer, nullable=False, default=5, index=True)
    run_at = db.Column(db.DateTime, nullable=True, index=True)

    attempts = db.Column(db.Integer, nullable=False, default=0)
    last_error = db.Column(db.Text, nullable=True)

    payload = db.Column(db.JSON, nullable=True)

    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    model = db.relationship("ModelInventory", back_populates="jobs")

    metric_summaries = db.relationship(
        "MetricSummary",
        back_populates="job",
        primaryjoin="JobQueue.id == MetricSummary.job_id",
        lazy="dynamic",
        cascade="all, delete-orphan",
    )

    # ---------- ADD THIS BACK ----------
    @classmethod
    def enqueue(
        cls,
        *,
        job_type: str,
        model_id: Optional[str] = None,
        payload: Optional[Dict[str, Any]] = None,
        priority: int = 5,
        run_at: Optional[datetime] = None,
        status: str = "queued",
        commit: bool = True,
    ) -> "JobQueue":
        """
        Create a job in 'queued' (or provided) status and return it.

        If commit=True (default), commits the transaction.
        Otherwise flushes so 'id' is available and leaves the TX open.
        """
        job = cls(
            job_type=job_type,
            model_id=model_id,
            payload=payload or {},
            priority=priority,
            run_at=run_at,
            status=status,
        )
        db.session.add(job)
        if commit:
            db.session.commit()
        else:
            db.session.flush()  # ensure job.id is populated without committing
        return job

    @classmethod
    def enqueue_many(cls, items: list[dict], commit: bool = True) -> list["JobQueue"]:
        """
        Bulk enqueue. Each item accepts the same keys as enqueue().
        """
        jobs: list[JobQueue] = []
        for it in items:
            jobs.append(
                cls(
                    job_type=it["job_type"],
                    model_id=it.get("model_id"),
                    payload=it.get("payload") or {},
                    priority=it.get("priority", 5),
                    run_at=it.get("run_at"),
                    status=it.get("status", "queued"),
                )
            )
        db.session.add_all(jobs)
        if commit:
            db.session.commit()
        else:
            db.session.flush()
        return jobs
