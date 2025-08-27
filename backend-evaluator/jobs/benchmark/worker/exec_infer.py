# worker/exec_infer.py
import threading, time, concurrent.futures as cf
from typing import Iterable, Callable, Optional, List, Any

class RateLimiter:
    def __init__(self, rps: float, cancel_event: Optional[threading.Event] = None):
        self.lock = threading.Lock()
        self.min_interval = 1.0 / max(0.001, rps)
        self.last = 0.0
        self.cancel_event = cancel_event

    def wait(self):
        with self.lock:
            now = time.perf_counter()
            dt = now - self.last
            remaining = self.min_interval - dt
            while remaining > 0:
                if self.cancel_event is not None and self.cancel_event.is_set():
                    # propagate a soft cancel
                    raise KeyboardInterrupt
                sleep_for = 0.05 if remaining > 0.05 else remaining
                time.sleep(sleep_for)
                remaining -= sleep_for
            self.last = time.perf_counter()

def run_parallel(
    tasks: Iterable[Any],
    fn: Callable[[Any], Any],
    concurrency: int,
    rps: float,
    cancel_event: Optional[threading.Event] = None,
):
    """
    Runs tasks with bounded concurrency. If cancel_event is set,
    pending futures are cancelled and we return early.
    """
    results: List[Any] = []
    with cf.ThreadPoolExecutor(max_workers=concurrency) as ex:
        pending = {ex.submit(fn, t) for t in tasks}
        try:
            while pending:
                if cancel_event is not None and cancel_event.is_set():
                    # cancel everything that hasn't started
                    for fut in pending:
                        fut.cancel()
                    break
                done, pending = cf.wait(pending, timeout=0.2, return_when=cf.FIRST_COMPLETED)
                for fut in done:
                    if not fut.cancelled():
                        results.append(fut.result())
        finally:
            ex.shutdown(cancel_futures=True)
    return results
