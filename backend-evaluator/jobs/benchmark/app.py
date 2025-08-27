#jobs\benchmark\app.py
import json
import argparse
import signal
import threading
import sys

from jobs.benchmark.worker.runner import post_onboard_evaluation

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", required=True, help="Path to job config JSON")
    ap.add_argument("--db", default="sqlite:///spectragram.db", help="SQLAlchemy DB URL")
    ap.add_argument("--max-utt", type=int, default=None, help="Global cap on utterances processed")
    ap.add_argument("--max-per-subset", type=int, default=None, help="Cap per dataset subset (clean/snr0/...)")
    args = ap.parse_args()

    with open(args.config, "r", encoding="utf-8") as f:
        cfg_json = f.read()

    cancel_event = threading.Event()

    def _handle_sig(_sig, _frame):
        cancel_event.set()

    # Handle Ctrl+C and terminate
    signal.signal(signal.SIGINT, _handle_sig)
    try:
        signal.signal(signal.SIGTERM, _handle_sig)
    except Exception:
        # SIGTERM may not be available in some environments; ignore.
        pass

    try:
        result = post_onboard_evaluation(
            cfg_json,
            db_url=args.db,
            cancel_event=cancel_event,
            max_utterances=args.max_utt,
            max_per_subset=args.max_per_subset,
        )
        print(json.dumps(result, indent=2))
    except KeyboardInterrupt:
        cancel_event.set()
        print("\nAborted by user (Ctrl+C).", file=sys.stderr)

if __name__ == "__main__":
    main()
