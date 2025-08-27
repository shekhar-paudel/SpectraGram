# providers/deepgram.py
import os, time, random, requests
from typing import Tuple
from jobs.benchmark.core.registry import ASRProvider, TranscriptResult

RETRY_STATUS = {429, 500, 502, 503, 504}

class DeepgramProvider(ASRProvider):
    name = "deepgram"

    def __init__(self, api_key: str):
        self.api_key = api_key

    def _post_with_retries(self, url: str, headers: dict, body: bytes,
                           timeout_s: int, max_retries: int = 6, base_backoff: float = 0.5) -> Tuple[requests.Response, float]:
        last_exc = None
        for attempt in range(1, max_retries + 1):
            try:
                t0 = time.perf_counter()
                resp = requests.post(url, headers=headers, data=body, timeout=timeout_s)
                elapsed = time.perf_counter() - t0
                if resp.status_code in RETRY_STATUS:
                    ra = resp.headers.get("Retry-After")
                    if ra:
                        try: wait = float(ra)
                        except ValueError: wait = base_backoff * (2 ** (attempt - 1))
                    else:
                        wait = base_backoff * (2 ** (attempt - 1))
                    if attempt < max_retries:
                        time.sleep(min(wait + random.uniform(0, 0.25), 10.0))
                        continue
                    resp.raise_for_status()
                resp.raise_for_status()
                return resp, elapsed
            except (requests.Timeout, requests.ConnectionError) as e:
                last_exc = e
                if attempt >= max_retries: raise
                wait = base_backoff * (2 ** (attempt - 1)) + random.uniform(0, 0.25)
                time.sleep(min(wait, 10.0))
            except requests.HTTPError:
                raise
        if last_exc: raise last_exc
        raise RuntimeError("Deepgram request failed without specific exception")

    def transcribe(self, audio_path: str, params: dict) -> Tuple[TranscriptResult, float]:
        model = params.get("model", "nova-3")
        language = params.get("language", "en")
        timeout_s = params.get("timeout_s", 120)

        url = f"https://api.deepgram.com/v1/listen?model={model}&language={language}&smart_format=true"
        headers = {
            "Authorization": f"Token {self.api_key}",
            "Content-Type": "application/octet-stream"
        }
        with open(audio_path, "rb") as f:
            body = f.read()

        resp, elapsed = self._post_with_retries(url, headers, body, timeout_s)
        j = resp.json()
        try:
            text = j["results"]["channels"][0]["alternatives"][0]["transcript"]
            words = j["results"]["channels"][0]["alternatives"][0].get("words")
        except Exception:
            text, words = "", None
        return TranscriptResult(text=text, words=words, usage=None, raw=j), elapsed

def make_deepgram_provider(api_key: str) -> DeepgramProvider:
    return DeepgramProvider(api_key)
