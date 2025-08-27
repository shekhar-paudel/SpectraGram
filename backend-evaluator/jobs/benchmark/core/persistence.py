# core/persistence.py
import queue, threading, time
from typing import Callable, Iterable
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from .models import Base

def make_engine(db_url="sqlite:///spectragram.db"):
    eng = create_engine(db_url, future=True)
    with eng.connect() as c:
        c.execute(text("PRAGMA journal_mode=WAL;"))
        c.execute(text("PRAGMA synchronous=NORMAL;"))
    return eng

def init_db(engine):
    Base.metadata.create_all(engine)

def make_session_factory(engine):
    return sessionmaker(bind=engine, autocommit=False, autoflush=False, future=True)

class WriterThread:
    """Thread-safe single-writer that consumes callables which receive a DB session."""
    def __init__(self, session_factory, batch_size=64):
        self.session_factory = session_factory
        self.q = queue.Queue()
        self._stop = threading.Event()
        self.batch_size = batch_size
        self.thread = threading.Thread(target=self._loop, daemon=True)

    def start(self): self.thread.start()
    def stop(self):
        self._stop.set()
        self.q.put(None)
        self.thread.join()

    def submit(self, fn: Callable):
        self.q.put(fn)

    def _loop(self):
        while not self._stop.is_set():
            items = []
            item = self.q.get()
            if item is None: break
            items.append(item)
            try:
                while len(items) < self.batch_size:
                    items.append(self.q.get_nowait())
            except queue.Empty:
                pass
            with self.session_factory() as s:
                try:
                    for fn in items:
                        fn(s)
                    s.commit()
                except Exception as e:
                    s.rollback()
                    raise
