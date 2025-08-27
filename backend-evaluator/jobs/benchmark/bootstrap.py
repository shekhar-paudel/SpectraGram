import os
from flask import Flask
from sqlalchemy import inspect, text
from jobs.benchmark.db import db

def make_app(db_url: str | None) -> Flask:
    app = Flask("spectragram_worker")
    uri = db_url or os.environ.get("DATABASE_URL") or "sqlite:///spectragram.db"
    app.config.update(
        SQLALCHEMY_DATABASE_URI=uri,
        SQLALCHEMY_TRACK_MODIFICATIONS=False,
    )
    if uri.startswith("sqlite:///"):
        app.config.setdefault("SQLALCHEMY_ENGINE_OPTIONS",
                              {"connect_args": {"check_same_thread": False}})
    db.init_app(app)
    return app

def ensure_db(app: Flask) -> None:
    # Ensure models are registered
    from jobs.benchmark.core.models import ModelInventory, JobQueue, MetricSummary  # noqa: F401
    with app.app_context():
        db.create_all()

        # (Optional) self-heal the 'model' column on SQLite for metric_summary
        try:
            insp = inspect(db.engine)
            if "metric_summary" in insp.get_table_names():
                colnames = {c["name"] for c in insp.get_columns("metric_summary")}
                if "model" not in colnames:
                    db.session.execute(text("ALTER TABLE metric_summary ADD COLUMN model VARCHAR(128)"))
                    db.session.commit()
        except Exception:
            pass
