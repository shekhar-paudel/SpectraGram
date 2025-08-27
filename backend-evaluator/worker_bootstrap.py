# worker_bootstrap.py
import os
from flask import Flask
from sqlalchemy import text, inspect
from dotenv import load_dotenv
from app.database import db

def _default_sqlite_uri() -> str:
    base = os.path.abspath(os.path.dirname(__file__))
    inst = os.path.join(base, "instance")
    os.makedirs(inst, exist_ok=True)
    return "sqlite:///" + os.path.join(inst, "spectragram.sqlite3")

def make_worker_app() -> Flask:
    # Load .env the same way your runner does
    load_dotenv(os.environ.get("ENVIRONMENT") == "0" and ".env.development" or ".env.production")

    app = Flask("worker")

    uri = (os.environ.get("DATABASE_URL")
           or os.environ.get("SQLALCHEMY_DATABASE_URI")
           or _default_sqlite_uri())

    app.config.update(
        SQLALCHEMY_DATABASE_URI=uri,
        SQLALCHEMY_TRACK_MODIFICATIONS=False,
    )
    if uri.startswith("sqlite:///"):
        app.config.setdefault("SQLALCHEMY_ENGINE_OPTIONS", {"connect_args": {"check_same_thread": False}})

    db.init_app(app)
    return app

def ensure_db(app: Flask, use_alembic: bool = False) -> None:
    # Import models so metadata is registered
    from jobs.benchmark.core.models import ModelInventory, JobQueue, MetricSummary  # noqa: F401

    with app.app_context():
        if use_alembic:
            try:
                from flask_migrate import upgrade
                upgrade()
            except Exception:
                db.create_all()
        else:
            db.create_all()

        # Optional: self-heal for the newly-added 'model' column on metric_summary (SQLite only)
        try:
            insp = inspect(db.engine)
            if "metric_summary" in insp.get_table_names():
                cols = {c["name"] for c in insp.get_columns("metric_summary")}
                if "model" not in cols:
                    db.session.execute(text("ALTER TABLE metric_summary ADD COLUMN model VARCHAR(128)"))
                    db.session.commit()
        except Exception:
            pass  # non-fatal
