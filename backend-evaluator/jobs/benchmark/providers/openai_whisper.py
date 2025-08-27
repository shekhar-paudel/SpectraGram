# providers/openai_whisper.py
import io, time, random, requests, os, mimetypes
from typing import Tuple
from jobs.benchmark.core.registry import ASRProvider, TranscriptResult

RETRY_STATUS = {429, 500, 502, 503, 504}

def _guess_mime(path: str) -> str:
    mt, _ = mimetypes.guess_type(path)
    # fallbacks that cover common speech files
    return mt or (
        "audio/wav" if path.lower().endswith((".wav", ".wave")) else
        "audio/mpeg" if path.lower().endswith((".mp3",)) else
        "audio/webm" if path.lower().endswith((".webm",)) else
        "audio/flac" if path.lower().endswith((".flac",)) else
        "application/octet-stream"
    )

def _normalize_model(model: str) -> str:
    """
    Keep your config values, but allow simple aliases if you want later.
    """
    return model  # e.g., map 'whisper' -> 'whisper-1' if you ever need to

class OpenAIWhisperProvider(ASRProvider):
    name = "openai"

    def __init__(self, api_key: str):
        self.api_key = api_key

    def _post_with_retries(
        self,
        url: str,
        headers: dict,
        filename: str,
        file_bytes: bytes,
        data: dict,
        timeout_s: int,
        max_retries: int = 6,
        base_backoff: float = 0.5,
    ) -> Tuple[requests.Response, float]:
        """
        Retries on 429/5xx, timeouts, and connection errors.
        Rebuilds multipart each attempt (fresh BytesIO).
        """
        last_exc = None
        mime = _guess_mime(filename)
        for attempt in range(1, max_retries + 1):
            try:
                files = {"file": (os.path.basename(filename), io.BytesIO(file_bytes), mime)}
                t0 = time.perf_counter()
                resp = requests.post(url, headers=headers, files=files, data=data, timeout=timeout_s)
                elapsed = time.perf_counter() - t0

                # Retry on throttle/server errors
                if resp.status_code in RETRY_STATUS:
                    ra = resp.headers.get("Retry-After")
                    if ra:
                        try:
                            wait = float(ra)
                        except ValueError:
                            wait = base_backoff * (2 ** (attempt - 1)) + random.uniform(0, 0.25)
                    else:
                        wait = base_backoff * (2 ** (attempt - 1)) + random.uniform(0, 0.25)
                    if attempt < max_retries:
                        time.sleep(min(wait, 10.0))
                        continue
                    # fallthrough to raise below
                # Raise for any non-2xx (after any retries)
                if resp.status_code >= 400:
                    # include server error body for diagnostics
                    try:
                        msg = resp.json().get("error", {}).get("message") or resp.text
                    except Exception:
                        msg = resp.text
                    raise requests.HTTPError(f"{resp.status_code} {resp.reason}: {msg}", response=resp)
                return resp, elapsed

            except (requests.Timeout, requests.ConnectionError) as e:
                last_exc = e
                if attempt >= max_retries:
                    raise
                wait = base_backoff * (2 ** (attempt - 1)) + random.uniform(0, 0.25)
                time.sleep(min(wait, 10.0))
        if last_exc:
            raise last_exc
        raise RuntimeError("OpenAI request failed without specific exception")

    def transcribe(self, audio_path: str, params: dict) -> Tuple[TranscriptResult, float]:
        model = _normalize_model(params.get("model", "whisper-1"))
        language = params.get("language", "en")  # BCP-47 tag; 'en' is fine
        timeout_s = params.get("timeout_s", 120)

        url = "https://api.openai.com/v1/audio/transcriptions"
        headers = {"Authorization": f"Bearer {self.api_key}"}

        with open(audio_path, "rb") as f:
            audio_bytes = f.read()

        # Only send params that the endpoint expects; strings only in 'data'
        data = {
            "model": model,
            "language": language,
            # optionally: "response_format": "json", "temperature": "0"
        }

        resp, elapsed = self._post_with_retries(url, headers, audio_path, audio_bytes, data, timeout_s)
        j = resp.json()
        text = j.get("text", "")
        return TranscriptResult(text=text, words=None, usage=None, raw=j), elapsed


def make_openai_provider(api_key: str) -> OpenAIWhisperProvider:
    return OpenAIWhisperProvider(api_key)
