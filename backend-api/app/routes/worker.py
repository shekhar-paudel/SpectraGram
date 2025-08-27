from collections import defaultdict
from flask import Blueprint, jsonify, request
from sqlalchemy import func,insert, delete
from app.database import db
from datetime import datetime
import traceback

from app.models import JobQueue,MetricSummary  # <-- import your queue model

import json

worker_bp = Blueprint("worker", __name__)


def _iso(dt: datetime | None) -> str | None:
    """Serialize datetimes to ISO-8601 (no micros) with trailing 'Z'."""
    if dt is None:
        return None
    return dt.replace(microsecond=0).isoformat() + "Z"


@worker_bp.route("/get_job_queue", methods=["GET"])
def get_job_queue():
    """
    GET /get_job_queue
      Optional: ?limit=10 (max 100)

    Returns the newest N jobs with the following fields:
      - model_id
      - job_type
      - status
      - priority
      - run_at
      - attempts
      - last_error
      - created_at
      - updated_at
    """
    try:
        # Parse and clamp limit
        limit_raw = request.args.get("limit", "10")
        try:
            limit = max(1, min(int(limit_raw), 100))
        except ValueError:
            limit = 10

        # Newest first
        jobs = (
            JobQueue.query
            .order_by(JobQueue.created_at.desc(), JobQueue.id.desc())
            .limit(limit)
            .all()
        )

        payload = {
            "jobs": [
                {
                    "model_id": j.model_id,
                    "job_type": j.job_type,
                    "status": j.status,
                    "priority": j.priority,
                    "run_at": _iso(j.run_at),
                    "attempts": j.attempts,
                    "last_error": j.last_error,
                    "created_at": _iso(j.created_at),
                    "updated_at": _iso(j.updated_at),
                }
                for j in jobs
            ]
        }
        return jsonify(payload), 200

    except Exception as e:
        return jsonify({"error": "Failed to fetch job queue", "details": str(e)}), 500


from flask import request, jsonify
from datetime import datetime
from sqlalchemy import or_

def _iso(dt):
    if not dt:
        return None
    return dt.replace(microsecond=0).isoformat() + "Z"

@worker_bp.route("/get_job_to_run", methods=["GET"])
def get_job_to_run():
    """
    GET /get_job_to_run?limit=10&types=post_onboard_eval,other

    - Returns queued & due jobs (status='queued' AND (run_at IS NULL OR run_at <= now)).
    - Optional 'limit' (clamped 1..50).
    - Optional 'types' CSV filter (e.g., 'post_onboard_eval,foo').
    """
    try:
        # Parse query params
        limit = request.args.get("limit", type=int)
        if limit is not None:
            limit = max(1, min(limit, 50))  # clamp 1..50

        types_param = request.args.get("types", type=str)
        type_list = [t.strip() for t in types_param.split(",") if t.strip()] if types_param else None

        # Base query: queued and due
        now = datetime.utcnow()
        q = (
            JobQueue.query
            .filter(
                JobQueue.status == "queued",
                or_(JobQueue.run_at == None, JobQueue.run_at <= now)
            )
        )
        if type_list:
            q = q.filter(JobQueue.job_type.in_(type_list))

        # Priority + FIFO ordering
        q = q.order_by(
            JobQueue.priority.asc(),
            JobQueue.run_at.asc(),
            JobQueue.created_at.asc(),
            JobQueue.id.asc(),
        )
        if limit is not None:
            q = q.limit(limit)

        jobs = q.all()

        return jsonify({
            "jobs": [
                {
                    "id": j.id,
                    "model_id": j.model_id,
                    "job_type": j.job_type,
                    "status": j.status,
                    "priority": j.priority,
                    "run_at": _iso(j.run_at),
                    "attempts": j.attempts,
                    "last_error": j.last_error,
                    "payload": j.payload,  # full JSON payload as stored
                    "created_at": _iso(j.created_at),
                    "updated_at": _iso(j.updated_at),
                }
                for j in jobs
            ]
        }), 200

    except Exception as e:
        return jsonify({"error": "Failed to fetch queued jobs", "details": str(e)}), 500

        
def _iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    return dt.replace(microsecond=0).isoformat() + "Z"

def _parse_iso(dt_str: str | None) -> datetime | None:
    if not dt_str:
        return None
    # Allow special keyword 'now'
    if dt_str.lower() == "now":
        return datetime.utcnow()
    try:
        # Try standard ISO-8601 (with or without trailing Z)
        s = dt_str.rstrip("Z")
        return datetime.fromisoformat(s)
    except Exception:
        return None
@worker_bp.route("/pick_up_job", methods=["GET", "POST"])
def pick_up_job():
    print("pick_up_job called")
    """
    Update a job. Prefer POST with JSON body (handles large payloads):
      POST /api/worker/pick_up_job
      {
        "id": "<job_id>",
        "updates": {
          "status": "done",
          "payload": {...},
          "metric_summary": [ ... ]   // optional; if omitted and status=="done",
                                      // will read payload.metric_summary if present
          // any of: model_id, job_type, priority, run_at, attempts, last_error
        }
      }

    Back-compat GET still works:
      GET /pick_up_job?id=<job_id>&status=processing&...&payload={...}&metric_summary=[...]

    Allowed updatable fields: model_id, job_type, status, priority, run_at, attempts, last_error, payload, metric_summary

    Persists metric_summary rows into MetricSummary table, joined by (job_id, model_id).
    """
    try:
        allowed = {
            "model_id", "job_type", "status", "priority", "run_at",
            "attempts", "last_error", "payload", "metric_summary"
        }

        # ---------- Parse input (prefer POST JSON) ----------
        if request.method == "POST":
            body = request.get_json(silent=True) or {}
            job_id = body.get("id") or body.get("job_id")
            print("body:", body)
            print("job_id:", job_id)
            if not job_id:
                return jsonify({"error": "Missing 'id' in JSON body"}), 400

            updates = body.get("updates")
            if updates is None:
                # also allow top-level fields in POST as a convenience
                updates = {k: v for k, v in body.items() if k not in ("id", "job_id")}
        else:
            job_id = request.args.get("id") or request.args.get("job_id")
            if not job_id:
                return jsonify({"error": "Missing required query parameter 'id' (or 'job_id')"}), 400
            updates = {k: v for k, v in request.args.items() if k in allowed}

        if not updates:
            return jsonify({"error": "No updatable fields provided", "allowed": sorted(list(allowed))}), 400

        job = JobQueue.query.get(job_id)
        if not job:
            return jsonify({"error": "Job not found", "id": job_id}), 404

        # ---------- Apply scalar fields ----------
        if "priority" in updates:
            try:
                job.priority = int(updates["priority"])
            except ValueError:
                return jsonify({"error": "Invalid 'priority' (int expected)"}), 400

        if "attempts" in updates:
            try:
                job.attempts = int(updates["attempts"])
            except ValueError:
                return jsonify({"error": "Invalid 'attempts' (int expected)"}), 400

        if "run_at" in updates:
            dt = _parse_iso(updates["run_at"])
            if updates["run_at"] and dt is None:
                return jsonify({"error": "Invalid 'run_at' (ISO-8601 or 'now' expected)"}), 400
            job.run_at = dt

        if "status" in updates:
            job.status = updates["status"]

        if "job_type" in updates:
            job.job_type = updates["job_type"]

        if "model_id" in updates:
            job.model_id = updates["model_id"] or None

        if "last_error" in updates:
            job.last_error = updates["last_error"] or None

        # ---------- Payload (JSON) ----------
        payload_obj = None
        if "payload" in updates:
            pv = updates["payload"]
            if isinstance(pv, (dict, list)):
                payload_obj = pv
            else:
                try:
                    payload_obj = json.loads(pv)
                except json.JSONDecodeError:
                    return jsonify({"error": "Invalid 'payload' (must be JSON)"}), 400
            job.payload = payload_obj

        # ---------- Metric summary (list[dict]) ----------
        metric_items = None

        if "metric_summary" in updates:
            mv = updates["metric_summary"]
            if isinstance(mv, list):
                metric_items = mv
            else:
                try:
                    metric_items = json.loads(mv)
                except json.JSONDecodeError:
                    return jsonify({"error": "Invalid 'metric_summary' (must be JSON)"}), 400

        # If not explicitly provided, but we just set status=done and payload has metric_summary → use that
        if metric_items is None and payload_obj and job.status == "done":
            maybe = payload_obj.get("metric_summary")
            if isinstance(maybe, list):
                metric_items = maybe

        job.updated_at = datetime.utcnow()
        db.session.add(job)

        # ---------- Persist metric_summary rows (idempotent per job) ----------
        persisted = 0
        if isinstance(metric_items, list):
            # clear previous rows for this job (idempotent on retry)
            db.session.execute(
                delete(MetricSummary).where(MetricSummary.job_id == job.id)
            )

            rows = []
            for rec in metric_items:
                rows.append({
                    "job_id": job.id,
                    "model_id": job.model_id,

                    "benchmark_id": rec.get("benchmark_id"),
                    "job_run_id": rec.get("job_run_id"),

                    "provider": rec.get("provider"),
                    "model": rec.get("model"),
                    "eval_version": rec.get("eval_version"),
                    "label": rec.get("label"),

                    "dataset_id": rec.get("dataset_id"),
                    "variant_id": rec.get("variant_id"),
                    "n_utterances": rec.get("n_utterances"),

                    "wer": rec.get("wer"),
                    "wer_ci_low": rec.get("wer_ci_low"),
                    "wer_ci_high": rec.get("wer_ci_high"),

                    "latency_p50_ms": rec.get("latency_p50_ms"),
                    "latency_p50_ms_ci_low": rec.get("latency_p50_ms_ci_low"),
                    "latency_p50_ms_ci_high": rec.get("latency_p50_ms_ci_high"),

                    "latency_p95_ms": rec.get("latency_p95_ms"),
                    "latency_p95_ms_ci_low": rec.get("latency_p95_ms_ci_low"),
                    "latency_p95_ms_ci_high": rec.get("latency_p95_ms_ci_high"),

                    "rtf_mean": rec.get("rtf_mean"),
                    "rtf_mean_ci_low": rec.get("rtf_mean_ci_low"),
                    "rtf_mean_ci_high": rec.get("rtf_mean_ci_high"),

                    "rtf_p95": rec.get("rtf_p95"),
                    "rtf_p95_ci_low": rec.get("rtf_p95_ci_low"),
                    "rtf_p95_ci_high": rec.get("rtf_p95_ci_high"),
                })

            if rows:
                db.session.execute(insert(MetricSummary), rows)
                persisted = len(rows)


        db.session.commit()

        return jsonify({
            "job": {
                "id": job.id,
                "model_id": job.model_id,
                "job_type": job.job_type,
                "status": job.status,
                "priority": job.priority,
                "run_at": _iso(job.run_at),
                "attempts": job.attempts,
                "last_error": job.last_error,
                "payload": job.payload,
                "created_at": _iso(job.created_at),
                "updated_at": _iso(job.updated_at),
            },
            "metric_summary_count": persisted
        }), 200

    except Exception as e:
        db.session.rollback()
        print("Failed to update job:", e)
        traceback.print_exc()
        return jsonify({"error": "Failed to update job", "details": str(e)}), 500
