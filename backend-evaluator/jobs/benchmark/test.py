import requests, os, mimetypes, io

key = ""
path = "data/librispeech/wav16/84/121123/84-121123-0000.wav"

mime = mimetypes.guess_type(path)[0] or "audio/wav"
files = {"file": (os.path.basename(path), open(path, "rb"), mime)}
data = {"model": "whisper-1", "language": "en"}

r = requests.post(
    "https://api.openai.com/v1/audio/transcriptions",
    headers={"Authorization": f"Bearer {key}"},
    files=files,
    data=data,
    timeout=120,
)
print(r.status_code, r.text)
