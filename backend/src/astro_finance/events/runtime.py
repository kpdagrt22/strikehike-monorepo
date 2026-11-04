"""Pipeline context, options and the stage runner."""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Callable, Mapping

from .bundle import BundleResult, DatasetArtifact, sha256_file
from .dedup import DedupResult
from .gates import GateResult
from .lifecycle import LifecycleResult
from .logging_utils import StructuredLogger, make_execution_id
from .models import Event, RawRecord, SourceRun, StageRecord
from .registry import Registry, SourceSpec, default_data_dir
from .security import redact_secrets
from .sources import SourceReject
from .sources.historical import seed_path_for

STAGES = (
    "discovery",
    "extraction",
    "normalization",
    "validation",
    "deduplication",
    "lifecycle",
    "enrichment",
    "theme_classification",
    "dataset_creation",
    "quality_report",
)

RETRY_POLICY: Mapping[str, tuple[int, float]] = {
    "extraction": (2, 0.5),
    "dataset_creation": (2, 0.5),
}


class PipelineError(RuntimeError):
    """A stage failed after its retry budget; the CLI exits 1."""


@dataclass(frozen=True, slots=True)
class PipelineOptions:
    out_dir: Path
    previous_dir: Path | None = None
    today: date = field(default_factory=lambda: datetime.now(timezone.utc).date())
    now: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    data_dir: Path = field(default_factory=default_data_dir)
    offline_dir: Path | None = None
    requested_sources: tuple[str, ...] | None = None
    execution_id: str | None = None
    created_at: datetime | None = None
    clock: Callable[[], datetime] | None = None
    macro_parquet: Path | None = None
    model_dir: Path | None = None
    macro_allow_unchanged_reason: str | None = None


@dataclass
class PipelineResult:
    out_dir: Path
    bundle_dir: Path
    bundle_version: str
    publishable: bool
    exit_code: int
    stage_records: tuple[StageRecord, ...]
    quality_report: dict[str, Any]
    manifest: dict[str, Any]
    rejects: tuple[dict[str, Any], ...]


@dataclass
class StageOutcome:
    input_count: int
    output_count: int


@dataclass
class PipelineContext:
    options: PipelineOptions
    logger: StructuredLogger
    execution_id: str
    registry: Registry | None = None
    source_specs: dict[str, SourceSpec] = field(default_factory=dict)
    source_runs: dict[str, SourceRun] = field(default_factory=dict)
    raw_records: list[RawRecord] = field(default_factory=list)
    source_rejects: list[SourceReject] = field(default_factory=list)
    normalized: list[Event] = field(default_factory=list)
    valid: list[Event] = field(default_factory=list)
    dedup: DedupResult | None = None
    lifecycle: LifecycleResult | None = None
    events: list[Event] = field(default_factory=list)
    artifact: DatasetArtifact | None = None
    gates: tuple[GateResult, ...] = ()
    report: dict[str, Any] = field(default_factory=dict)
    bundle: BundleResult | None = None
    rejects: list[dict[str, Any]] = field(default_factory=list)
    extracted_counts: dict[str, int] = field(default_factory=dict)
    rejected_counts: dict[str, int] = field(default_factory=dict)
    previous_events: list[Event] = field(default_factory=list)
    previous_manifest: dict[str, Any] | None = None
    previous_historical_source_sha256: str | None = None
    historical_source_sha256: str = "missing"
    raw_files: list[Path] = field(default_factory=list)
    data_version: str | None = None
    macro_validation: Any = None
    model_lifecycle: dict[str, Any] | None = None

    def clock(self) -> datetime:
        if self.options.clock:
            return self.options.clock()
        return datetime.now(timezone.utc)


def _append_stage_record(
    out_dir: Path, execution_id: str, record: StageRecord
) -> None:
    runs_dir = out_dir / "runs"
    runs_dir.mkdir(parents=True, exist_ok=True)
    path = runs_dir / f"{execution_id}.jsonl"
    with path.open("a", encoding="utf-8") as handle:
        handle.write(
            json.dumps(record.to_dict(), ensure_ascii=False, sort_keys=True) + "\n"
        )


def run_pipeline(
    options: PipelineOptions,
    *,
    logger: StructuredLogger | None = None,
) -> PipelineResult:
    """Run every stage; a gate failure still produces a bundle and exits 2."""

    from . import io_utils
    from .pipeline import STAGE_FUNCTIONS

    out_dir = options.out_dir
    out_dir.mkdir(parents=True, exist_ok=True)
    source_ids = tuple(options.requested_sources or ())
    execution_id = options.execution_id or make_execution_id(
        options.now, options.today, source_ids
    )
    active_logger = logger or StructuredLogger(execution_id)
    ctx = PipelineContext(
        options=options, logger=active_logger, execution_id=execution_id
    )
    seed_path = seed_path_for(options.data_dir)
    ctx.historical_source_sha256 = (
        sha256_file(seed_path) if seed_path.exists() else "missing"
    )
    io_utils.load_previous(ctx)
    records: list[StageRecord] = []

    for stage in STAGES:
        retries_allowed, backoff = RETRY_POLICY.get(stage, (0, 0.0))
        retries = 0
        while True:
            started = ctx.clock()
            active_logger.info("stage_start", stage=stage, retries=retries)
            try:
                outcome = STAGE_FUNCTIONS[stage](ctx)
            except Exception as exc:
                ended = ctx.clock()
                message = redact_secrets(f"{type(exc).__name__}: {exc}")
                if retries < retries_allowed:
                    retries += 1
                    active_logger.warning(
                        "stage_retry", stage=stage, error=message, retries=retries
                    )
                    time.sleep(backoff * retries)
                    continue
                record = StageRecord(
                    execution_id=execution_id,
                    stage=stage,
                    started_at=started,
                    ended_at=ended,
                    duration_ms=int((ended - started).total_seconds() * 1000),
                    status="failed",
                    input_count=0,
                    output_count=0,
                    error=message,
                    retries=retries,
                    data_version=ctx.data_version,
                )
                records.append(record)
                _append_stage_record(out_dir, execution_id, record)
                active_logger.error("stage_failed", stage=stage, error=message)
                raise PipelineError(f"stage {stage} failed: {message}") from exc
            ended = ctx.clock()
            record = StageRecord(
                execution_id=execution_id,
                stage=stage,
                started_at=started,
                ended_at=ended,
                duration_ms=int((ended - started).total_seconds() * 1000),
                status="ok",
                input_count=outcome.input_count,
                output_count=outcome.output_count,
                error=None,
                retries=retries,
                data_version=ctx.data_version,
            )
            records.append(record)
            _append_stage_record(out_dir, execution_id, record)
            active_logger.info(
                "stage_end",
                stage=stage,
                input_count=outcome.input_count,
                output_count=outcome.output_count,
                retries=retries,
            )
            break

    assert ctx.bundle is not None and ctx.lifecycle is not None
    publishable = ctx.bundle.publishable
    return PipelineResult(
        out_dir=out_dir,
        bundle_dir=ctx.bundle.bundle_dir,
        bundle_version=ctx.bundle.bundle_version,
        publishable=publishable,
        exit_code=0 if publishable else 2,
        stage_records=tuple(records),
        quality_report=ctx.bundle.quality_report,
        manifest=ctx.bundle.manifest,
        rejects=tuple(ctx.rejects),
    )
