# core/registry.py
from typing import Dict, Protocol, Iterable, Any

# ---- Provider interface
class TranscriptResult:
    def __init__(self, text: str, words=None, usage=None, raw=None):
        self.text = text
        self.words = words
        self.usage = usage
        self.raw = raw

class ASRProvider(Protocol):
    name: str
    def transcribe(self, audio_path: str, params: dict) -> TranscriptResult: ...

PROVIDER_REGISTRY: Dict[str, ASRProvider] = {}

# ---- Dataset interface
class Utterance:
    def __init__(self, utt_id: str, audio_path: str, ref_text: str, duration_s: float, meta: dict):
        self.utt_id = utt_id
        self.audio_path = audio_path
        self.ref_text = ref_text
        self.duration_s = duration_s
        self.meta = meta or {}

class DatasetLoader(Protocol):
    id: str
    def iter_utterances(self, split: str | None, variant: dict, lang: str | None) -> Iterable[Utterance]: ...

DATASET_REGISTRY: Dict[str, DatasetLoader] = {}

# ---- Evaluation interface
class RunContext:
    def __init__(self, session_factory, job_run_id: int, cfg, logger):
        self.session_factory = session_factory
        self.job_run_id = job_run_id
        self.cfg = cfg
        self.logger = logger

class EvaluationPipeline(Protocol):
    version: str
    def run(self, run_ctx: RunContext) -> None: ...

EVAL_REGISTRY: Dict[str, EvaluationPipeline] = {}
