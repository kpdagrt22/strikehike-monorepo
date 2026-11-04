"""The ten stage transforms, in execution order.

The stage runner lives in :mod:`astro_finance.events.runtime`; this module owns
the transforms so they can be tested in isolation.
"""

from __future__ import annotations

import json
from dataclasses import replace
from pathlib import Path
from typing import Callable, Mapping

from .bundle import finalize_bundle, quality_report_markdown, write_dataset
from .dedup import deduplicate
from .gates import GateContext, GateResult, run_gates
from .io_utils import summary, write_raw, write_rejects
from .lifecycle import merge_with_previous
from .macro_data import MacroDataError, validate_macro_refresh
from .model_bundle import model_gate, model_info
from .models import EventKind, SourceRun, iso_utc, parse_utc, replace_event
from .registry import default_data_dir, load_registry, select_sources
from .reporting import quality_report_payload
from .runtime import (
    STAGES,
    PipelineContext,
    PipelineError,
    PipelineOptions,
    PipelineResult,
    StageOutcome,
    run_pipeline,
)
from .security import redact_secrets
from .sources import SourceExtraction, extract_source
from .validation import (
    NormalizationError,
    normalize_raw,
    reject_payload,
    validate_event,
)

__all__ = [
    "PipelineContext",
    "PipelineError",
    "PipelineOptions",
    "PipelineResult",
    "StageOutcome",
    "STAGES",
    "run_pipeline",
]


def stage_discovery(ctx: PipelineContext) -> StageOutcome:
    registry = load_registry(ctx.options.data_dir / "sources.toml")
    selected = select_sources(registry, list(ctx.options.requested_sources or []))
    ctx.registry = registry
    ctx.source_specs = {source.id: source for source in selected}
    for source_id in ctx.source_specs:
        ctx.extracted_counts[source_id] = 0
        ctx.rejected_counts[source_id] = 0
    return StageOutcome(0, len(ctx.source_specs))


def _previous_last_success(ctx: PipelineContext, source_id: str):
    if not ctx.previous_manifest:
        return None
    for source in ctx.previous_manifest.get("sources", []):
        if source.get("id") == source_id and source.get("last_success_at"):
            try:
                return parse_utc(str(source["last_success_at"]))
            except ValueError:
                return None
    return None


def stage_extraction(ctx: PipelineContext) -> StageOutcome:
    for source in ctx.source_specs.values():
        extraction: SourceExtraction | None = None
        error: str | None = None
        try:
            extraction = extract_source(
                source,
                today=ctx.options.today,
                now=ctx.options.now,
                data_dir=ctx.options.data_dir,
                offline_dir=ctx.options.offline_dir,
            )
        except Exception as exc:  # adapter errors are recorded, never silent
            error = redact_secrets(f"{type(exc).__name__}: {exc}")
            ctx.logger.error(
                "source_failed", source=source.id, error=error, stage="extraction"
            )
        if extraction is not None and extraction.error:
            error = redact_secrets(extraction.error)
        payloads = extraction.raw_payloads if extraction else {}
        ctx.raw_files.extend(write_raw(ctx.options.out_dir, source.id, payloads, error))
        records = extraction.records if extraction else ()
        rejects = extraction.rejects if extraction else ()
        ctx.extracted_counts[source.id] += len(records) + len(rejects)
        ctx.rejected_counts[source.id] += len(rejects)
        ctx.raw_records.extend(records)
        ctx.source_rejects.extend(rejects)
        fetched_this_run = error is None and extraction is not None
        last_success = (
            ctx.options.now
            if fetched_this_run
            else _previous_last_success(ctx, source.id)
        )
        ctx.source_runs[source.id] = SourceRun(
            source_id=source.id,
            fetched_this_run=fetched_this_run,
            fetched_at=(
                extraction.fetched_at if fetched_this_run and extraction else None
            ),
            last_success_at=last_success,
            record_count=len(records),
            rejected_count=len(rejects),
            error=error,
        )
        ctx.logger.info(
            "source_extracted",
            stage="extraction",
            source=source.id,
            records=len(records),
            rejects=len(rejects),
            fetched=fetched_this_run,
            error=error,
        )
    return StageOutcome(len(ctx.source_specs), len(ctx.raw_records))


def stage_normalization(ctx: PipelineContext) -> StageOutcome:
    for reject in ctx.source_rejects:
        ctx.rejects.append(
            {
                "source_id": reject.source_id,
                "name": str(reject.raw.get("name", "")),
                "var": "source",
                "raw": dict(reject.raw),
                "reasons": list(reject.reasons),
                "rejected_at": iso_utc(ctx.options.now),
            }
        )
    for raw in ctx.raw_records:
        source = ctx.source_specs[raw.source_id]
        try:
            event = normalize_raw(
                raw, source, today=ctx.options.today, now=ctx.options.now
            )
        except NormalizationError as exc:
            ctx.rejected_counts[raw.source_id] += 1
            ctx.rejects.append(reject_payload(raw, exc.reasons, now=ctx.options.now))
        except Exception as exc:
            ctx.rejected_counts[raw.source_id] += 1
            ctx.rejects.append(
                reject_payload(
                    raw,
                    [redact_secrets(f"{type(exc).__name__}: {exc}")],
                    now=ctx.options.now,
                )
            )
        else:
            ctx.normalized.append(event)
    write_rejects(ctx)
    return StageOutcome(
        len(ctx.raw_records) + len(ctx.source_rejects), len(ctx.normalized)
    )


def stage_validation(ctx: PipelineContext) -> StageOutcome:
    for event in ctx.normalized:
        reasons = validate_event(
            event,
            today=ctx.options.today,
            source=ctx.source_specs.get(event.source_id),
        )
        if reasons:
            ctx.rejected_counts[event.source_id] = (
                ctx.rejected_counts.get(event.source_id, 0) + 1
            )
            ctx.rejects.append(
                {
                    "source_id": event.source_id,
                    "name": event.name,
                    "var": "event",
                    "event_id": event.event_id,
                    "raw": event.to_dict(),
                    "reasons": reasons,
                    "rejected_at": iso_utc(ctx.options.now),
                }
            )
        else:
            ctx.valid.append(event)
    write_rejects(ctx)
    return StageOutcome(len(ctx.normalized), len(ctx.valid))


def stage_deduplication(ctx: PipelineContext) -> StageOutcome:
    reliability = {
        source_id: spec.reliability
        for source_id, spec in ctx.source_specs.items()
    }
    ctx.dedup = deduplicate(ctx.valid, reliability)
    ctx.logger.info(
        "deduplicated",
        stage="deduplication",
        kept=len(ctx.dedup.events),
        duplicates=ctx.dedup.duplicates,
    )
    return StageOutcome(len(ctx.valid), len(ctx.dedup.events))


def stage_lifecycle(ctx: PipelineContext) -> StageOutcome:
    assert ctx.dedup is not None
    successful = {
        source_id
        for source_id, run in ctx.source_runs.items()
        if run.fetched_this_run
    }
    changed = (
        ctx.previous_historical_source_sha256 is not None
        and ctx.previous_historical_source_sha256 != ctx.historical_source_sha256
    )
    ctx.lifecycle = merge_with_previous(
        ctx.dedup.events,
        ctx.previous_events,
        today=ctx.options.today,
        now=ctx.options.now,
        successful_source_ids=successful,
        historical_source_changed=changed,
    )
    ctx.events = ctx.lifecycle.events
    ctx.logger.info(
        "lifecycle_merged",
        stage="lifecycle",
        previous=len(ctx.previous_events),
        current=len(ctx.events),
        updated=ctx.lifecycle.updated_count,
        historical_seed_changed=changed,
    )
    return StageOutcome(len(ctx.dedup.events), len(ctx.events))


def stage_enrichment(ctx: PipelineContext) -> StageOutcome:
    enriched = []
    for event in ctx.events:
        days = (
            (event.start_date - ctx.options.today).days
            if event.kind is EventKind.UPCOMING
            else None
        )
        enriched.append(replace_event(event, days_until=days))
    ctx.events = enriched
    return StageOutcome(len(enriched), len(enriched))


def stage_classification(ctx: PipelineContext) -> StageOutcome:
    for event in ctx.events:
        source = ctx.source_specs.get(event.source_id)
        if source is None:
            raise PipelineError(f"event {event.event_id} has no enabled source")
        if event.theme not in source.themes:
            raise PipelineError(
                f"event {event.event_id} theme {event.theme.value!r} is not "
                f"declared by {source.id!r}"
            )
    return StageOutcome(len(ctx.events), len(ctx.events))


def _macro_baseline(ctx: PipelineContext) -> Path:
    if ctx.options.previous_dir is not None:
        previous = (
            ctx.options.previous_dir / "data" / "macro_regime_history.parquet"
        )
        if previous.is_file():
            return previous
    return default_data_dir().parent / "processed" / "macro_regime_history.parquet"


def stage_dataset(ctx: PipelineContext) -> StageOutcome:
    staging = ctx.options.out_dir / f".bundle-{ctx.execution_id}"
    if ctx.options.macro_parquet is not None:
        baseline = _macro_baseline(ctx)
        try:
            ctx.macro_validation = validate_macro_refresh(
                ctx.options.macro_parquet,
                baseline,
                allow_unchanged_reason=ctx.options.macro_allow_unchanged_reason,
            )
        except MacroDataError as exc:
            raise PipelineError(f"macro dataset validation failed: {exc}") from exc
    ctx.artifact = write_dataset(
        staging,
        ctx.events,
        today=ctx.options.today,
        macro_parquet=ctx.options.macro_parquet,
        model_dir=ctx.options.model_dir,
    )
    ctx.model_lifecycle = model_info(ctx.options.model_dir)
    ctx.data_version = ctx.artifact.bundle_version
    return StageOutcome(len(ctx.events), len(ctx.events))


def stage_quality(ctx: PipelineContext) -> StageOutcome:
    assert ctx.artifact is not None
    notes = []
    for source_id, run in list(ctx.source_runs.items()):
        ctx.source_runs[source_id] = replace(
            run, rejected_count=ctx.rejected_counts.get(source_id, run.rejected_count)
        )
    if ctx.previous_manifest is None:
        notes.append("No previous bundle was supplied; lifecycle started fresh.")
    if (
        ctx.previous_historical_source_sha256 is not None
        and ctx.previous_historical_source_sha256 != ctx.historical_source_sha256
    ):
        notes.append("historical_events.json changed since the previous bundle.")
    for run in ctx.source_runs.values():
        if run.error:
            notes.append(f"Source {run.source_id} reported: {run.error}")
    report_summary = summary(ctx)
    preview = quality_report_payload(
        events=ctx.events,
        source_runs=ctx.source_runs,
        gate_results=[],
        today=ctx.options.today,
        bundle_version=ctx.artifact.bundle_version,
        summary=report_summary,
        notes=notes,
        offline_build=ctx.options.offline_dir is not None,
        macro_data=(
            ctx.macro_validation.to_dict()
            if ctx.macro_validation is not None
            else None
        ),
        model_lifecycle=ctx.model_lifecycle,
    )
    source_preview = json.dumps(
        [
            {
                "id": source_id,
                "url": spec.url,
                "themes": [theme.value for theme in spec.themes],
                "error": ctx.source_runs[source_id].error,
            }
            for source_id, spec in ctx.source_specs.items()
        ],
        ensure_ascii=False,
        sort_keys=True,
    )
    output_texts = {
        "events.json": ctx.artifact.events_json.decode("utf-8"),
        "events.sqlite": ctx.artifact.sqlite_path.read_bytes().decode("latin-1"),
        "quality_report.json.preview": json.dumps(preview, ensure_ascii=False),
        "quality_report.md.preview": quality_report_markdown(preview),
        "manifest.json.preview": source_preview,
    }
    rejects_path = ctx.options.out_dir / "rejects.json"
    if rejects_path.exists():
        output_texts["rejects.json"] = rejects_path.read_text(encoding="utf-8")
    gate_ctx = GateContext(
        events=ctx.events,
        source_specs=ctx.source_specs,
        source_runs=ctx.source_runs,
        today=ctx.options.today,
        now=ctx.options.now,
        previous_manifest=ctx.previous_manifest,
        extracted_counts=ctx.extracted_counts,
        rejected_counts=ctx.rejected_counts,
        data_dir=ctx.options.data_dir,
        historical_source_sha256=ctx.historical_source_sha256,
        previous_historical_source_sha256=ctx.previous_historical_source_sha256,
        output_texts=output_texts,
    )
    ctx.gates = tuple(run_gates(gate_ctx))
    extra_gates = []
    if ctx.macro_validation is not None:
        validation = ctx.macro_validation
        extra_gates.append(
            GateResult(
                "macro_data",
                "pass" if validation.passed else "fail",
                (
                    "macro refresh checks passed"
                    if validation.passed
                    else "; ".join(validation.reasons)
                ),
            )
        )
    model_result = model_gate(ctx.options.model_dir)
    if model_result is not None:
        extra_gates.append(model_result)
    ctx.gates = tuple(ctx.gates) + tuple(extra_gates)
    report = quality_report_payload(
        events=ctx.events,
        source_runs=ctx.source_runs,
        gate_results=list(ctx.gates),
        today=ctx.options.today,
        bundle_version=ctx.artifact.bundle_version,
        summary=report_summary,
        notes=notes,
        offline_build=ctx.options.offline_dir is not None,
        macro_data=(
            ctx.macro_validation.to_dict()
            if ctx.macro_validation is not None
            else None
        ),
        model_lifecycle=ctx.model_lifecycle,
    )
    ctx.report = report
    ctx.bundle = finalize_bundle(
        ctx.options.out_dir,
        ctx.artifact,
        events=ctx.events,
        source_specs=ctx.source_specs,
        source_runs=ctx.source_runs,
        gate_results=list(ctx.gates),
        report=report,
        created_at=ctx.options.created_at or ctx.options.now,
        today=ctx.options.today,
        execution_id=ctx.execution_id,
        historical_source_sha256=ctx.historical_source_sha256,
        macro_data=(
            ctx.macro_validation.to_dict()
            if ctx.macro_validation is not None
            else None
        ),
        models=ctx.model_lifecycle,
    )
    return StageOutcome(len(ctx.events), len(ctx.events))


STAGE_FUNCTIONS: Mapping[str, Callable[[PipelineContext], StageOutcome]] = {
    "discovery": stage_discovery,
    "extraction": stage_extraction,
    "normalization": stage_normalization,
    "validation": stage_validation,
    "deduplication": stage_deduplication,
    "lifecycle": stage_lifecycle,
    "enrichment": stage_enrichment,
    "theme_classification": stage_classification,
    "dataset_creation": stage_dataset,
    "quality_report": stage_quality,
}
