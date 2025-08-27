# core/normalize.py
import re
from jiwer import Compose, ToLowerCase, RemovePunctuation, RemoveMultipleSpaces, ExpandCommonEnglishContractions, Strip

# Small generic regex transform compatible with jiwer.Compose
class RegexSub:
    def __init__(self, pattern: str, repl: str):
        self._re = re.compile(pattern)
        self._repl = repl
    def __call__(self, s: str) -> str:
        return self._re.sub(self._repl, s)

# Mirror your config flags; this matches TextNormCfg fields we referenced
class _CfgShim:
    def __init__(self, lowercase=True, remove_punct=True, remove_numbers=False, collapse_whitespace=True):
        self.lowercase = lowercase
        self.remove_punct = remove_punct
        self.remove_numbers = remove_numbers
        self.collapse_whitespace = collapse_whitespace

def build_norm_pipeline(cfg: _CfgShim):
    ops = []

    # Expand contractions early
    ops.append(ExpandCommonEnglishContractions())

    if cfg.lowercase:
        ops.append(ToLowerCase())

    if cfg.remove_punct:
        ops.append(RemovePunctuation())

    # Replace missing jiwer.RemoveNumbers with a regex
    if cfg.remove_numbers:
        ops.append(RegexSub(r"\d+", ""))

    if cfg.collapse_whitespace:
        # Collapse any whitespace runs to a single space, then strip ends
        ops.append(RegexSub(r"\s+", " "))
        ops.append(Strip())
        # (RemoveMultipleSpaces is harmless but redundant after RegexSub; keep if you like)
        # ops.append(RemoveMultipleSpaces())

    return Compose(ops)
