# run.py
import os
from dotenv import load_dotenv

# ✅ Load correct .env based on ENVIRONMENT (Flask 2.3+ standard)
debug = os.environ.get("ENVIRONMENT", "0")
dotenv_file = ".env.development" if debug == "0" else ".env.production"
load_dotenv(dotenv_file)
# worker_entrypoint.py (example)
from processor.job_runner import run_forever, post_onboard_evaluation, DEFAULT_SUPPORTED_JOBS

SUPPORTED_JOBS = {"post_onboard_eval"}  # can override defaults if you want

def run_worker():
    print("🚀 Worker starting…")
    run_forever(supported_jobs=SUPPORTED_JOBS, poll_limit=10)

if __name__ == "__main__":
    run_worker()
