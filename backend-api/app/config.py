import os
from dotenv import load_dotenv

# Determine environment
env = os.getenv("FLASK_ENV", "development").lower()
dotenv_file = f".env.{env}"
print(f"🔧 Loading environment variables from {dotenv_file}")

if os.path.exists(dotenv_file):
    load_dotenv(dotenv_file)

# Resolve absolute and cross-platform SQLite path
raw_path = os.getenv("DATABASE_URL_PATH", "instance/SpectraGram.db")
db_path = os.path.abspath(raw_path).replace("\\", "/")
full_sqlite_uri = f"sqlite:///{db_path}"

class Config:
    SECRET_KEY = os.getenv("SECRET_KEY", "dev")
    SQLALCHEMY_DATABASE_URI = full_sqlite_uri
    print(f"📦 Using SQLite DB: {SQLALCHEMY_DATABASE_URI}")
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    DEBUG = os.getenv("DEBUG", "false").lower() == "true"
