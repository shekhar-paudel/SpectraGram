# worker/plan.py
from typing import Iterable
from jobs.benchmark.core.registry import DATASET_REGISTRY, Utterance

class Task:
    def __init__(self, dataset_key, utt: Utterance):
        self.dataset_key = dataset_key  # (dataset_name, subset_meta dict)
        self.utt = utt

def build_tasks(cfg) -> Iterable[Task]:
    tasks = []
    for ds_id in cfg.Datasets:
        loader = DATASET_REGISTRY[ds_id]
        # The loader will yield all subsets/variants it owns by default
        for utt in loader.iter_utterances(split=None, variant=None, lang=None):
            # Stash subset identity into dataset_key via utt.meta
            subset = {k: v for k, v in (utt.meta or {}).items() if k in ("subset","snr_db","bandwidth","lang","split")}
            tasks.append(Task(dataset_key=(ds_id, subset), utt=utt))
    return tasks
