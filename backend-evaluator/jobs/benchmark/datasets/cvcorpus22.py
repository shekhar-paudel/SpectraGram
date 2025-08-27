# datasets/cv_corpus_22.py
import csv, os
from typing import Iterable, Optional, Dict, List
from core.registry import DatasetLoader, Utterance, DATASET_REGISTRY

# Hard-coded base(s) for Common Voice v22 data (no env vars)
_CANDIDATE_BASES = ["./data/cvcorpus22", "data/cvcorpus22"]

# By default we load English test split.
_DEFAULT_LANGS: List[str] = ["en"]
_DEFAULT_SPLITS: List[str] = ["test"]

def _find_base_dir() -> str:
    tried = []
    for base in _CANDIDATE_BASES:
        base = os.path.normpath(base)
        probe = os.path.join(base, "en_test.csv")  # probe a common file
        tried.append(probe)
        if os.path.isfile(probe):
            return base
    # fallback: if directory exists, return it anyway so open() shows exact missing file
    for base in _CANDIDATE_BASES:
        if os.path.isdir(base):
            return os.path.normpath(base)
    raise FileNotFoundError(
        "Common Voice v22 base not found. Looked for e.g. 'en_test.csv' under:\n  - "
        + "\n  - ".join(tried)
        + "\nPlace files like ./data/cvcorpus22/en_test.csv (or en_dev.csv, en_train.csv)."
    )

def _parse_row(row: Dict[str, str]):
    utt_id = row.get("utt_id") or row.get("id")
    audio_path = row.get("path") or row.get("audio_path")
    ref_text = row.get("reference_text") or row.get("ref_text") or ""
    dur = row.get("duration_sec") or row.get("duration_s") or None
    duration_s = float(dur) if dur not in (None, "",) else None
    return utt_id, audio_path, ref_text, duration_s

class CVCorpusV22Loader(DatasetLoader):
    """
    Loader for Common Voice v22, registered id='cvcorpus22'.
    Expects CSVs named '{lang}_{split}.csv' under ./data/cvcorpus22/.
      e.g., en_test.csv, en_dev.csv, en_train.csv
    Columns (robust): utt_id|id, path|audio_path, reference_text|ref_text, duration_sec|duration_s (optional)
    """
    id = "cvcorpus22"

    def __init__(self, langs: Optional[List[str]] = None, splits: Optional[List[str]] = None):
        self.base = _find_base_dir()
        self.langs = langs or _DEFAULT_LANGS
        self.splits = splits or _DEFAULT_SPLITS

    def iter_utterances(self, split: Optional[str], variant: Optional[dict], lang: Optional[str]) -> Iterable[Utterance]:
        langs = [lang] if lang else self.langs
        splits = [split] if split else self.splits
        for L in langs:
            for S in splits:
                path = os.path.join(self.base, f"{L}_{S}.csv")
                with open(path, newline="", encoding="utf-8") as f:
                    r = csv.DictReader(f)
                    for row in r:
                        utt_id, audio_path, ref_text, duration_s = _parse_row(row)
                        yield Utterance(
                            utt_id=utt_id,
                            audio_path=audio_path,
                            ref_text=ref_text,
                            duration_s=duration_s,
                            meta={"subset": f"{L}_{S}", "lang": L, "split": S, "version": "22"},
                        )

# Register under the hyphenated id your JSON will use
DATASET_REGISTRY["cvcorpus22"] = CVCorpusV22Loader()
