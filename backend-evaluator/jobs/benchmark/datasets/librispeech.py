# datasets/librispeech.py
import csv
import os
from typing import Iterable, Dict, Optional

from jobs.benchmark.core.registry import DATASET_REGISTRY, DatasetLoader, Utterance

# Hard-coded candidate bases (no env vars, no manifests/)
_CANDIDATE_BASES = ["jobs/benchmark/data/librispeech", "jobs/benchmark/data/librispeech"]

# Standard subsets relative to base
_SUBSETS = [
    ("metadata/dataset_clean.csv",  {"subset": "clean", "snr_db": None}),
    ("metadata/dataset_snr0.csv",  {"subset": "snr0",  "snr_db": 0}),
    ("metadata/dataset_snr10.csv", {"subset": "snr10", "snr_db": 10}),
    ("metadata/dataset_snr20.csv", {"subset": "snr20", "snr_db": 20}),
    ("metadata/dataset_tel8k.csv", {"subset": "tel8k", "bandwidth": "8k"}),
]


def _find_base_dir() -> str:
    tried = []
    for base in _CANDIDATE_BASES:
        base = os.path.normpath(base)
        probe = os.path.join(base, "metadata", "dataset_clean.csv")
        tried.append(probe)
        if os.path.isfile(probe):
            return base
    raise FileNotFoundError(
        "LibriSpeech base not found. Looked for 'metadata/dataset_clean.csv' under:\n  - "
        + "\n  - ".join(tried)
        + "\nPlace files under ./data/librispeech/metadata/ (e.g., ./data/librispeech/metadata/dataset_clean.csv)."
    )


def _parse_row(row: Dict[str, str]):
    # Robust column extraction across your CSV variants
    utt_id = row.get("utt_id") or row.get("id") or row.get("utt")
    audio_path = row.get("path") or row.get("audio_path")
    ref_text = row.get("reference_text") or row.get("ref_text") or ""
    dur = row.get("duration_sec") or row.get("duration_s") or None
    duration_s = float(dur) if (dur not in (None, "")) else None
    meta = {}
    for k in ("speaker_id", "gender", "speaker_name", "split"):
        if k in row and row[k] != "":
            meta[k] = row[k]
    return utt_id, audio_path, ref_text, duration_s, meta


class LibriSpeechLoader(DatasetLoader):
    id = "librispeech"

    def __init__(self, subsets=None):
        self.base = _find_base_dir()
        self.subsets = subsets or _SUBSETS

    def _iter_one_csv(self, rel_csv: str, variant_meta: dict) -> Iterable[Utterance]:
        path = os.path.join(self.base, rel_csv)
        with open(path, newline="", encoding="utf-8") as f:
            r = csv.DictReader(f)
            for row in r:
                utt_id, audio_path, ref_text, duration_s, meta = _parse_row(row)
                meta = {**meta, **variant_meta}
                yield Utterance(
                    utt_id=utt_id,
                    audio_path=audio_path,
                    ref_text=ref_text,
                    duration_s=duration_s,
                    meta=meta,
                )

    # split/lang are unused for this structure; loader emits all standard subsets
    def iter_utterances(self, split: Optional[str], variant: Optional[dict], lang: Optional[str]) -> Iterable[Utterance]:
        for rel_csv, vmeta in self.subsets:
            yield from self._iter_one_csv(rel_csv, vmeta)


# Register in the global dataset registry
DATASET_REGISTRY["librispeech"] = LibriSpeechLoader()
