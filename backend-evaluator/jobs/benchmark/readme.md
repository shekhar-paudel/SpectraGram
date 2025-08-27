
py -m venv .venv
source .venv\bin\activate
.venv\Scripts\activate.bat

pip install -r requirements.txt
python app.py --config jobs/openai_librispeech.json --max-utt 50
# or
python app.py --config jobs/deepgram_librispeech.json --max-per-subset 10
# or both
python app.py --config jobs/openai_librispeech.json --max-per-subset 10 --max-utt 30
py jobs\benchmark\app.py  --config jobs/deepgram_librispeech.json --max-per-subset 10


spectragram_bench/
  app.py                         # entrypoints / CLI glue
  core/
    config.py                    # Pydantic models; JSON schema
    registry.py                  # plugin registries
    timing.py                    # timers/helpers
    normalize.py                 # text normalization pipeline(s)
    metrics.py                   # WER, CER, latency stats
    bootstrap.py                 # CI routines
    persistence.py               # SQLAlchemy session + single-writer queue
    models.py                    # SQLAlchemy ORM tables
  providers/
    __init__.py
    deepgram.py
    openai_whisper.py
    mock_provider.py             # for tests
  datasets/
    __init__.py
    librispeech.py
    commonvoice.py
  evaluations/
    v1/
      pipeline.py                # computes WER, latency, bootstrap
  worker/
    runner.py                    # run loop; pulls jobs; calls post_onboard_evaluation
    plan.py                      # builds execution plan graph
    exec_infer.py                # concurrency, rate limiting, retries
  tests/
    ...





Core entities (columns omitted for brevity; *_json are JSON blobs for metadata):

provider (provider_id PK, name, sdk, sdk_version, extra_json)

model (model_id PK, provider_id FK, name, revision, params_json)

dataset (dataset_id PK, name, source, license, checksum, notes)

dataset_variant (variant_id PK, dataset_id FK, split, variant_json) ← e.g., { "snr_db": 0 }

utterance (utt_id PK, dataset_id FK, variant_id FK, external_id, audio_path, ref_text, duration_s, meta_json)

benchmark (benchmark_id PK, created_at, config_json, notes)

job_run (job_run_id PK, benchmark_id FK, provider_id FK, model_id FK, eval_version, started_at, ended_at, status, error_text, env_json, host_info_json)

env_json stores CUDA/device, OS, CPU/GPU, and exact lib versions for reproducibility.

prediction (prediction_id PK, job_run_id FK, utt_id FK, hyp_text, words_json, usage_json, created_at)

words_json for word timestamps (if provider supports).

latency_sample (lat_id PK, job_run_id FK, utt_id FK, api_time_ms, total_time_ms, rtf, meta_json)

You can store “time_to_first_token_ms” here if streaming.

metric_summary (summary_id PK, job_run_id FK, dataset_id FK, variant_id FK, metric, value, extra_json)

e.g., ("wer", 0.072), ("rtf_mean", 0.31), ("latency_p95_ms", 840).

bootstrap_result (boot_id PK, job_run_id FK, dataset_id FK, variant_id FK, metric, ci_low, ci_high, iterations, method, seed, extra_json)

(Optional) cost_summary (cost_id PK, job_run_id FK, seconds_billed, price_usd, extra_json)

Keys & constraints

Unique: (job_run_id, utt_id) in prediction and latency_sample to avoid duplicates.

Unique: (dataset_id, variant_id, external_id) in utterance.

Indexes on benchmark_id, job_run_id, dataset_id.