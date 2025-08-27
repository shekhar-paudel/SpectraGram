# core/config.py
from pydantic import BaseModel, Field
from typing import List, Dict, Optional, Literal

class JobConfig(BaseModel):
    BenchmarkID: str
    Provider: Literal["deepgram", "openai"]
    Model: str
    ApiKeys: Dict[str, str] = Field(default_factory=dict)  # {"deepgram":"...", "openai":"..."}
    EvaluationVersion: str = "v1"
    Datasets: List[str]  # e.g., ["librispeech", "cv-corpus"]
    RunNotes: Optional[str] = None
