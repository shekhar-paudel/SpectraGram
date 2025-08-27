# core/models.py
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship
from sqlalchemy import String, Integer, Float, JSON, Text, ForeignKey, Index, DateTime
from datetime import datetime

class Base(DeclarativeBase): pass

class Provider(Base):
    __tablename__ = "provider"
    provider_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String, unique=True)
    sdk: Mapped[str] = mapped_column(String)
    sdk_version: Mapped[str] = mapped_column(String, default="")
    extra_json: Mapped[dict] = mapped_column(JSON, default={})

class Model(Base):
    __tablename__ = "model"
    model_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    provider_id: Mapped[int] = mapped_column(ForeignKey("provider.provider_id"))
    name: Mapped[str] = mapped_column(String)
    revision: Mapped[str] = mapped_column(String, default="")
    params_json: Mapped[dict] = mapped_column(JSON, default={})

class Dataset(Base):
    __tablename__ = "dataset"
    dataset_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String)
    source: Mapped[str] = mapped_column(String, default="")
    license: Mapped[str] = mapped_column(String, default="")
    checksum: Mapped[str] = mapped_column(String, default="")
    notes: Mapped[str] = mapped_column(Text, default="")

class DatasetVariant(Base):
    __tablename__ = "dataset_variant"
    variant_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    dataset_id: Mapped[int] = mapped_column(ForeignKey("dataset.dataset_id"))
    split: Mapped[str | None] = mapped_column(String, nullable=True)
    variant_json: Mapped[dict] = mapped_column(JSON, default={})

class Utterance(Base):
    __tablename__ = "utterance"
    utt_pk: Mapped[int] = mapped_column(Integer, primary_key=True)
    dataset_id: Mapped[int] = mapped_column(ForeignKey("dataset.dataset_id"))
    variant_id: Mapped[int] = mapped_column(ForeignKey("dataset_variant.variant_id"))
    external_id: Mapped[str] = mapped_column(String)     # utt_id
    audio_path: Mapped[str] = mapped_column(String)
    ref_text: Mapped[str] = mapped_column(Text)
    duration_s: Mapped[float | None] = mapped_column(Float, nullable=True)   # <— now nullable
    meta_json: Mapped[dict] = mapped_column(JSON, default={})
    __table_args__ = (Index("ix_utt_unique", "dataset_id", "variant_id", "external_id", unique=True),)

    
class Benchmark(Base):
    __tablename__ = "benchmark"
    benchmark_id: Mapped[str] = mapped_column(String, primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    config_json: Mapped[dict] = mapped_column(JSON)
    notes: Mapped[str] = mapped_column(Text, default="")

class JobRun(Base):
    __tablename__ = "job_run"
    job_run_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    benchmark_id: Mapped[str] = mapped_column(ForeignKey("benchmark.benchmark_id"))
    provider_id: Mapped[int] = mapped_column(ForeignKey("provider.provider_id"))
    model_id: Mapped[int] = mapped_column(ForeignKey("model.model_id"))
    eval_version: Mapped[str] = mapped_column(String)
    started_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    status: Mapped[str] = mapped_column(String, default="running")  # running|completed|failed
    error_text: Mapped[str] = mapped_column(Text, default="")
    env_json: Mapped[dict] = mapped_column(JSON, default={})
    host_info_json: Mapped[dict] = mapped_column(JSON, default={})

class Prediction(Base):
    __tablename__ = "prediction"
    prediction_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    job_run_id: Mapped[int] = mapped_column(ForeignKey("job_run.job_run_id"))
    utt_pk: Mapped[int] = mapped_column(ForeignKey("utterance.utt_pk"))
    hyp_text: Mapped[str] = mapped_column(Text)
    words_json: Mapped[dict] = mapped_column(JSON, default={})
    usage_json: Mapped[dict] = mapped_column(JSON, default={})
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    __table_args__ = (Index("ix_pred_unique", "job_run_id", "utt_pk", unique=True),)

class LatencySample(Base):
    __tablename__ = "latency_sample"
    lat_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    job_run_id: Mapped[int] = mapped_column(ForeignKey("job_run.job_run_id"))
    utt_pk: Mapped[int] = mapped_column(ForeignKey("utterance.utt_pk"))
    api_time_ms: Mapped[float] = mapped_column(Float)
    total_time_ms: Mapped[float] = mapped_column(Float)
    rtf: Mapped[float | None] = mapped_column(Float, nullable=True) 
    meta_json: Mapped[dict] = mapped_column(JSON, default={})
    __table_args__ = (Index("ix_lat_unique", "job_run_id", "utt_pk", unique=True),)

class MetricSummary(Base):
    __tablename__ = "metric_summary"
    summary_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    job_run_id: Mapped[int] = mapped_column(ForeignKey("job_run.job_run_id"))
    dataset_id: Mapped[int] = mapped_column(ForeignKey("dataset.dataset_id"))
    variant_id: Mapped[int] = mapped_column(ForeignKey("dataset_variant.variant_id"))
    metric: Mapped[str] = mapped_column(String)
    value: Mapped[float] = mapped_column(Float)
    extra_json: Mapped[dict] = mapped_column(JSON, default={})

class BootstrapResult(Base):
    __tablename__ = "bootstrap_result"
    boot_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    job_run_id: Mapped[int] = mapped_column(ForeignKey("job_run.job_run_id"))
    dataset_id: Mapped[int] = mapped_column(ForeignKey("dataset.dataset_id"))
    variant_id: Mapped[int] = mapped_column(ForeignKey("dataset_variant.variant_id"))
    metric: Mapped[str] = mapped_column(String)
    ci_low: Mapped[float] = mapped_column(Float)
    ci_high: Mapped[float] = mapped_column(Float)
    iterations: Mapped[int] = mapped_column(Integer)
    method: Mapped[str] = mapped_column(String)
    seed: Mapped[int] = mapped_column(Integer)
    extra_json: Mapped[dict] = mapped_column(JSON, default={})
