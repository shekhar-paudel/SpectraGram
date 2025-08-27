from collections import defaultdict
from flask import Blueprint, jsonify, request
from datetime import datetime
from app.database import db
from app.models import ModelInventory, JobQueue,MetricSummary
import hashlib
from sqlalchemy import func
from datetime import datetime
from sqlalchemy import text, inspect as sqla_inspect



model_dashboard_bp = Blueprint("model_dashboard", __name__)



@model_dashboard_bp.route("/onboard_model", methods=["POST"])
def onboard_model():
    """
    Upsert ModelInventory and enqueue a post_onboard_eval job on create.
    Uses the NEW schema:
      - basicInformation.provider, modelName, modelVersion, supportedLanguage, tags
      - access.apiKey (stored in ModelInventory.data)
      - access.requestQuota -> worker max_per_subset (optional)
      - evalPlan.evalVersion, evalPlan.datasets
    API keys are persisted (per your request) and also passed to the worker job.
    reports_dir is NOT passed; the worker uses its own default.
    """
    body = request.get_json(silent=True)
    if not body:
        return jsonify({"error": "Invalid or missing JSON payload"}), 400

    def gv(path, default=None):
        cur = body
        for p in path.split("."):
            if not isinstance(cur, dict) or p not in cur:
                return default
            cur = cur[p]
        return cur

    # Read new-schema fields (with light fallback)
    provider  = gv("basicInformation.provider") or body.get("provider")
    model     = gv("basicInformation.modelName") or body.get("model")
    eval_ver  = gv("evalPlan.evalVersion") or "v1"
    datasets  = gv("evalPlan.datasets") or ["librispeech"]
    api_key   = gv("access.apiKey") or body.get("apiKey")  # store & pass to worker
    base_url  = gv("access.baseUrl") or body.get("baseUrl")
    quota_str = gv("access.requestQuota")

    if not provider or not model:
        return jsonify({"error": "Missing basicInformation.provider/modelName"}), 400
    if not api_key:
        return jsonify({"error": "Missing access.apiKey"}), 400

    # Optional: clamp/validate max_per_subset
    max_per_subset = None
    try:
        if quota_str not in (None, ""):
            max_per_subset = max(1, int(quota_str))
    except Exception:
        max_per_subset = None

    # Model ID: accept provided, else generate
    model_id = body.get("id")
    if not model_id:
        from uuid import uuid4
        model_id = f"{provider}-{model}-{uuid4().hex[:8]}"

    try:
        existing = ModelInventory.query.get(model_id)
        created = existing is None

        if existing:
            # Store the payload as-is (including access.apiKey, per your request)
            existing.data = body
            existing.updated_at = datetime.utcnow()
            db.session.add(existing)
            action = "updated"
            enqueued_job_id = None

        else:
            # Create with the full payload (including access.apiKey)
            record = ModelInventory(id=model_id, data=body)
            db.session.add(record)
            action = "created"

            # --- Build worker job payload ---
            # Unique BenchmarkID
            ts = datetime.utcnow().strftime("%Y_%m_%d_%H%M%S")
            prefix = provider[:2].lower()
            benchmark_id = f"{prefix}_bmk_{ts}_{model_id}"

            # Runner expects a provider-keyed ApiKeys map; fill the chosen provider
            api_keys_map = {
                "openai": api_key if provider == "openai" else "",
                "deepgram": api_key if provider == "deepgram" else "",
            }

            config = {
                "BenchmarkID": benchmark_id,
                "Provider": provider,
                "Model": model,
                "ApiKeys": api_keys_map,
                "EvaluationVersion": eval_ver,
                "Datasets": datasets,
                # "RunNotes": omitted as requested
            }
            # Optional: pass baseUrl via Meta if your provider needs it
            if base_url:
                config["Meta"] = {"baseUrl": base_url}

            job_payload = {
                "config": config,
                # No reports_dir here (worker has a default)
                **({"max_per_subset": max_per_subset} if max_per_subset is not None else {}),
            }

            job = JobQueue.enqueue(
                job_type="post_onboard_eval",
                model_id=model_id,
                payload=job_payload,
                priority=5,
                run_at=None,
                status="queued",
            )
            enqueued_job_id = job.id

        db.session.commit()

        resp = {"id": model_id, "status": action}
        if created:
            resp["job"] = {
                "id": enqueued_job_id,
                "job_type": "post_onboard_eval",
                "status": "queued",
            }
        return jsonify(resp), 200

    except Exception as e:
        db.session.rollback()
        return jsonify({"error": "Database error", "details": str(e)}), 500



@model_dashboard_bp.route("/list_of_model", methods=["GET"])
def list_of_model():
    """
    Returns a JSON list of all ModelInventory IDs.
    Optional query param:
      - q: substring filter (case-insensitive) applied to id
    """
    try:
      q = ModelInventory.query.with_entities(ModelInventory.id)
      search = request.args.get("q", type=str)

      if search:
          q = q.filter(ModelInventory.id.ilike(f"%{search}%"))

      # newest first based on created_at
      ids = [row[0] for row in q.order_by(ModelInventory.created_at.desc()).all()]
      return jsonify(ids), 200

    except Exception as e:
      return jsonify({"error": "Database error", "details": str(e)}), 500


@model_dashboard_bp.route("/model_detail", methods=["GET"])
def model_detail():
    """
    GET /model_detail?id=<model_id>
    Returns the full 'data' column (JSON) for the given model id.
    """
    from app.models import ModelInventory  # local import to avoid circulars if any

    model_id = request.args.get("id", type=str)
    if not model_id:
        return jsonify({"error": "Missing required query param 'id'"}), 400

    rec = ModelInventory.query.get(model_id)
    if not rec:
        return jsonify({"error": "Model not found", "id": model_id}), 404

    # rec.data is already a JSON-serializable dict
    return jsonify(rec.data), 200




# --------------------------- helpers ---------------------------

def _parse_ids_from_query():
    """
    Accepts either:
      ?ids=a,b,c
      or repeated ?id=a&id=b
    Returns de-duplicated, order-preserved list.
    """
    ids = request.args.getlist("id") or []
    ids_csv = request.args.get("ids")
    if ids_csv:
        ids.extend([s.strip() for s in ids_csv.split(",") if s.strip()])
    # dedupe, preserve order
    seen = set()
    out = []
    for i in ids:
        if i not in seen:
            out.append(i)
            seen.add(i)
    return out

def _parse_langs_from_query():
    langs_csv = request.args.get("langs")
    if langs_csv:
        langs = [s.strip() for s in langs_csv.split(",") if s.strip()]
    else:
        langs = ["en", "es", "de"]  # sensible defaults
    return langs

def _det_uniform(key: str, a: float, b: float) -> float:
    """
    Deterministic pseudo-random in [a, b] based on key.
    """
    h = hashlib.sha256(key.encode("utf-8")).hexdigest()
    n = int(h[:8], 16)
    r = (n % 10_000_000) / 10_000_000.0
    return a + (b - a) * r

@model_dashboard_bp.route("/model_benchmark_accuracy", methods=["GET"])
def model_benchmark_accuracy():
    """
    GET /model_benchmark_accuracy?ids=<id1,id2,...>&langs=<en,es,...>
      or repeated ?id=...&id=... and ?langs=en,es

    NEW response shape:
    {
      "ids": [...],
      "langs": [...],
      "metrics": [
        {
          "name": "WER",
          "models": [
            {"id": "<model_id>", "exists": true|false, "values": {"en": 0.0831, "es": 0.1012, ...}},
            ...
          ]
        },
        {
          "name": "WA",
          "models": [
            {"id": "<model_id>", "exists": true|false, "values": {"en": 0.9169, "es": 0.8988, ...}},
            ...
          ]
        }
      ]
    }
    """
    ids = _parse_ids_from_query()
    if not ids:
        return jsonify({"error": "Provide at least one model id via ?ids= or ?id="}), 400

    langs = _parse_langs_from_query()

    # Build per-metric arrays
    wer_models = []
    wa_models = []

    for mid in ids:
        exists = ModelInventory.query.get(mid) is not None

        per_lang_wer = {}
        per_lang_wa = {}
        for lang in langs:
            wer = _det_uniform(f"acc|{mid}|{lang}|wer", 0.05, 0.25)  # 5%..25%
            wa = max(0.0, 1.0 - wer)

            per_lang_wer[lang] = round(wer, 4)
            per_lang_wa[lang] = round(wa, 4)

        wer_models.append({"id": mid, "exists": exists, "values": per_lang_wer})
        wa_models.append({"id": mid, "exists": exists, "values": per_lang_wa})

    payload = {
        "ids": ids,
        "langs": langs,
        "metrics": [
            {"name": "WER", "models": wer_models},
            {"name": "WA",  "models": wa_models},
        ],
    }
    return jsonify(payload), 200


@model_dashboard_bp.route("/model_benchmark_Performance", methods=["GET"])
def model_benchmark_Performance():
    """
    GET /model_benchmark_Performance?ids=<id1,id2,...>&langs=<en,es,...>
      or repeated ?id=...&id=... and ?langs=en,es

    NEW response shape:
    {
      "ids": [...],
      "langs": [...],
      "metrics": [
        {
          "name": "WPM",
          "models": [
            {"id": "<model_id>", "exists": true|false, "values": {"en": 205.4, "es": 198.6, ...}},
            ...
          ]
        },
        {
          "name": "RTF",
          "models": [
            {"id": "<model_id>", "exists": true|false, "values": {"en": 0.41, "es": 0.55, ...}},
            ...
          ]
        },
        {
          "name": "LatencyMs",
          "models": [
            {"id": "<model_id>", "exists": true|false, "values": {"en": 372, "es": 410, ...}},
            ...
          ]
        },
        {
          "name": "ResponseLatencyMs",
          "models": [
            {"id": "<model_id>", "exists": true|false, "values": {"en": 118, "es": 132, ...}},
            ...
          ]
        }
      ]
    }
    """
    ids = _parse_ids_from_query()
    if not ids:
        return jsonify({"error": "Provide at least one model id via ?ids= or ?id="}), 400

    langs = _parse_langs_from_query()

    # Prepare per-metric containers
    wpm_models = []
    rtf_models = []
    lat_models = []
    frl_models = []

    for mid in ids:
        exists = ModelInventory.query.get(mid) is not None

        per_lang_wpm = {}
        per_lang_rtf = {}
        per_lang_lat = {}
        per_lang_frl = {}

        for lang in langs:
            wpm = _det_uniform(f"perf|{mid}|{lang}|wpm", 160.0, 260.0)   # words/min
            rtf = _det_uniform(f"perf|{mid}|{lang}|rtf", 0.20, 1.20)     # real-time factor
            lat = _det_uniform(f"perf|{mid}|{lang}|lat", 150.0, 800.0)   # ms
            frl = _det_uniform(f"perf|{mid}|{lang}|frl",  60.0, 260.0)   # ms

            per_lang_wpm[lang] = round(wpm, 1)
            per_lang_rtf[lang] = round(rtf, 3)
            per_lang_lat[lang] = int(round(lat))
            per_lang_frl[lang] = int(round(frl))

        wpm_models.append({"id": mid, "exists": exists, "values": per_lang_wpm})
        rtf_models.append({"id": mid, "exists": exists, "values": per_lang_rtf})
        lat_models.append({"id": mid, "exists": exists, "values": per_lang_lat})
        frl_models.append({"id": mid, "exists": exists, "values": per_lang_frl})

    payload = {
        "ids": ids,
        "langs": langs,
        "metrics": [
            {"name": "WPM",               "models": wpm_models},
            {"name": "RTF",               "models": rtf_models},
            {"name": "LatencyMs",         "models": lat_models},
            {"name": "ResponseLatencyMs", "models": frl_models},
        ],
    }
    return jsonify(payload), 200


@model_dashboard_bp.route("/model_leaderboard", methods=["GET"])
def model_leaderboard():
    """
    GET /model_leaderboard
    Always returns langs=["en"] and metrics: WER, RTF, LatencyMs (p50), ResponseLatencyMs (p95)

    Response:
    {
      "ids": [...],
      "langs": ["en"],
      "metrics": [
        {"name":"WER","models":[{"id":"...", "exists": true, "values":{"en": 0.083}, "ranks":{"en":2}}, ...]},
        {"name":"RTF","models":[...]},
        {"name":"LatencyMs","models":[...]},
        {"name":"ResponseLatencyMs","models":[...]}
      ]
    }
    """

    def _add_ranks(models_list, langs, higher_better: bool):
        if not models_list:
            return models_list
        for lang in langs:
            pairs = []
            for m in models_list:
                val = m.get("values", {}).get(lang, None)
                pairs.append((m["id"], val))
            if higher_better:
                pairs.sort(key=lambda x: ((x[1] is None), -(x[1] or 0), x[0]))
            else:
                pairs.sort(key=lambda x: ((x[1] is None), (x[1] if x[1] is not None else 0), x[0]))
            rank_for_id = {mid: i + 1 for i, (mid, _) in enumerate(pairs)}
            for m in models_list:
                m.setdefault("ranks", {})
                m["ranks"][lang] = rank_for_id.get(m["id"])
        return models_list

    # ---------------- collect model ids ----------------
    ids = [
        row[0]
        for row in ModelInventory.query
            .with_entities(ModelInventory.id)
            .order_by(ModelInventory.created_at.desc())
            .all()
    ]

    langs = ["en"]

    if not ids:
        return jsonify({"ids": [], "langs": langs, "metrics": []}), 200

    # ---------------- pull MetricSummary and keep latest per (model, dataset_name, variant) ----------------
    rows = (
        MetricSummary.query
        .filter(MetricSummary.model_id.in_(ids))
        .all()
    )

    latest_by_key = {}  # (model_id, dataset_name, variant_id) -> row
    for r in rows:
        key = (r.model_id, r.dataset_name or f"dataset_{r.dataset_id}", r.variant_id or 0)
        if key not in latest_by_key or r.created_at > latest_by_key[key].created_at:
            latest_by_key[key] = r

    # Group rows by model
    by_model = {}
    for r in latest_by_key.values():
        by_model.setdefault(r.model_id, []).append(r)

    # ---------------- build metrics ----------------
    wer_models, rtf_models, lat_models, frl_models = [], [], [], []

    for mid in ids:
        rows_m = by_model.get(mid, [])
        any_data = len(rows_m) > 0

        # weighted sums (weights = n_utterances, default 1)
        def _accumulate(get_val):
            s, w = 0.0, 0
            for rr in rows_m:
                v = get_val(rr)
                if v is None:
                    continue
                ww = int(rr.n_utterances or 0) or 1
                s += float(v) * ww
                w += ww
            return (s / w) if w > 0 else None

        wer_en = _accumulate(lambda rr: rr.wer)
        rtf_en = _accumulate(lambda rr: rr.rtf_mean)
        lat_p50_en = _accumulate(lambda rr: rr.latency_p50_ms)
        lat_p95_en = _accumulate(lambda rr: rr.latency_p95_ms)

        wer_models.append({"id": mid, "exists": any_data, "values": {"en": (round(wer_en, 4) if wer_en is not None else None)}})
        rtf_models.append({"id": mid, "exists": any_data, "values": {"en": (round(rtf_en, 3) if rtf_en is not None else None)}})
        lat_models.append({"id": mid, "exists": any_data, "values": {"en": (int(round(lat_p50_en)) if lat_p50_en is not None else None)}})
        frl_models.append({"id": mid, "exists": any_data, "values": {"en": (int(round(lat_p95_en)) if lat_p95_en is not None else None)}})

    # ranks (only for 'en')
    _add_ranks(wer_models, langs, higher_better=False)
    _add_ranks(rtf_models, langs, higher_better=False)
    _add_ranks(lat_models, langs, higher_better=False)
    _add_ranks(frl_models, langs, higher_better=False)

    payload = {
        "ids": ids,
        "langs": langs,
        "metrics": [
            {"name": "WER",               "models": wer_models},
            {"name": "RTF",               "models": rtf_models},
            {"name": "LatencyMs",         "models": lat_models},          # p50
            {"name": "ResponseLatencyMs", "models": frl_models},          # p95
        ],
    }
    return jsonify(payload), 200



def _serialize_summary_row(ms: MetricSummary) -> dict:
    return {
        "benchmark_id": ms.benchmark_id,
        "job_run_id": ms.job_run_id,
        "provider": ms.provider,
        "model": ms.model,
        "eval_version": ms.eval_version,
        "label": ms.label,
        "dataset_id": ms.dataset_id,
        "dataset_name": ms.dataset_name,
        "variant_id": ms.variant_id,
        "n_utterances": ms.n_utterances,
        "wer": ms.wer,
        "wer_ci_low": ms.wer_ci_low,
        "wer_ci_high": ms.wer_ci_high,
        "latency_p50_ms": ms.latency_p50_ms,
        "latency_p50_ms_ci_low": ms.latency_p50_ms_ci_low,
        "latency_p50_ms_ci_high": ms.latency_p50_ms_ci_high,
        "latency_p95_ms": ms.latency_p95_ms,
        "latency_p95_ms_ci_low": ms.latency_p95_ms_ci_low,
        "latency_p95_ms_ci_high": ms.latency_p95_ms_ci_high,
        "rtf_mean": ms.rtf_mean,
        "rtf_mean_ci_low": ms.rtf_mean_ci_low,
        "rtf_mean_ci_high": ms.rtf_mean_ci_high,
        "rtf_p95": ms.rtf_p95,
        "rtf_p95_ci_low": ms.rtf_p95_ci_low,
        "rtf_p95_ci_high": ms.rtf_p95_ci_high,
    }

def _load_dataset_labels() -> dict[int, str]:
    """
    Attempt to resolve dataset_id -> human-friendly key.
    Tries common table names/columns; falls back to 'dataset_{id}'.
    """
    mapping: dict[int, str] = {}
    try:
        inspector = sqla_inspect(db.engine)
        table_names = set(inspector.get_table_names())
        candidate = None
        for name in ("dataset", "datasets", "dataset_inventory", "asr_datasets"):
            if name in table_names:
                candidate = name
                break
        if not candidate:
            return mapping

        cols = inspector.get_columns(candidate)
        col_names = {c["name"] for c in cols}
        label_col = next((c for c in ("slug", "name", "dataset_name", "code") if c in col_names), None)
        if not label_col:
            return mapping

        rows = db.session.execute(text(f"SELECT id, {label_col} FROM {candidate}")).fetchall()
        for rid, label in rows:
            mapping[int(rid)] = str(label)
    except Exception as e:
        # Non-fatal: just use dataset_{id}
        print(f"Dataset label resolution skipped: {e}")
    return mapping
@model_dashboard_bp.route("/model_benchmark_v1", methods=["GET"])
def model_benchmark_v1():
    """
    Optional filters (as query params):
      - provider
      - benchmark_id
      - job_id
      - job_run_id (int)
      - model_id            # single value
      - ids                 # NEW: comma-separated or repeated model ids
      - dataset_id (int)
      - variant_id (int)
      - limit (int)
    """
    q = MetricSummary.query

    # --- Filters ---
    provider = request.args.get("provider")
    if provider:
        q = q.filter(MetricSummary.provider == provider)

    benchmark_id = request.args.get("benchmark_id")
    if benchmark_id:
        q = q.filter(MetricSummary.benchmark_id == benchmark_id)

    job_id = request.args.get("job_id")
    if job_id:
        q = q.filter(MetricSummary.job_id == job_id)

    # Single model_id (kept for backward compatibility)
    model_id = request.args.get("model_id")
    if model_id:
        q = q.filter(MetricSummary.model_id == model_id)

    # NEW: multiple model ids via ?ids=a,b,c or ?ids=a&ids=b...
    raw_ids = request.args.getlist("ids")
    if raw_ids:
        ids_list = []
        for chunk in raw_ids:
            # handle comma-separated chunks
            ids_list.extend([s.strip() for s in chunk.split(",") if s.strip()])
        if ids_list:  # only apply IN when non-empty
            q = q.filter(MetricSummary.model_id.in_(ids_list))

    def _as_int(name):
        v = request.args.get(name, type=int)
        return v if v is not None else None

    job_run_id = _as_int("job_run_id")
    if job_run_id is not None:
        q = q.filter(MetricSummary.job_run_id == job_run_id)

    dataset_id = _as_int("dataset_id")
    if dataset_id is not None:
        q = q.filter(MetricSummary.dataset_id == dataset_id)

    variant_id = _as_int("variant_id")
    if variant_id is not None:
        q = q.filter(MetricSummary.variant_id == variant_id)

    q = q.order_by(
        MetricSummary.provider.asc(),
        MetricSummary.dataset_id.asc().nulls_last(),
        MetricSummary.variant_id.asc().nulls_last(),
        MetricSummary.created_at.desc(),  # newest first within a group
    )

    limit = request.args.get("limit", type=int)
    rows = (q.limit(limit).all() if limit else q.all())

    # Build dataset label map
    ds_labels = _load_dataset_labels()

    # Group → provider → dataset_key → [rows]
    from collections import defaultdict
    grouped: dict[str, dict[str, list[dict]]] = defaultdict(lambda: defaultdict(list))
    for ms in rows:
        prov = ms.provider or "unknown"
        if ms.dataset_id is None:
            ds_key = "unknown_dataset"
        else:
            # NOTE: if your frontend assumes numeric dataset keys,
            # consider using str(ms.dataset_id) here instead of a label.
            ds_key = ds_labels.get(ms.dataset_id, f"dataset_{ms.dataset_id}")
        grouped[prov][ds_key].append(_serialize_summary_row(ms))

    payload = [{"provider": prov, "datasets": datasets} for prov, datasets in grouped.items()]
    print( payload)
    return jsonify(payload), 200
