# processor/config.py
import os
from flask_sqlalchemy import SQLAlchemy

DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    raise ValueError("DATABASE_URL not set in environment")

db = SQLAlchemy()
