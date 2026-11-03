"""Quality gates.  A bundle is publishable only when every gate passes."""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Mapping

from .models import (
    Event,
    EventKind,
    EventStatus,
    SourceRun,
    Theme,
    canonical_json,
    iso_utc,
    sha256_hex,
)
from .registry import SourceSpec
from .security import find_secret_patterns
from .sources.historical import seed_path_for
from .text import is_https_url, normalize_text, parse_date
from .validation import event_set_hash, validate_events, event_id_for

MAX_REJECT_RATE = 0.05


@dataclass(frozen=True, slots=True)
class GateResult:
    gate_id: str
    status: str
    reason: str


@dataclass(frozen=True, slots=True)
class GateContext:
    events: list[Event]
    source_specs: Mapping[str, SourceSpec]
    source_runs: Mapping[str, SourceRun]
    today: date
    now: datetime
    previous_manifest: Mapping[str, Any] | None
    extracted_counts: Mapping[str, int]
    rejected_counts: Mapping[str, int]
    data_dir: Path
    historical_source_sha256: str
    previous_historical_source_sha256: str | None
    output_texts: Mapping[str, str]


def gate_final_schema(ctx: GateContext) -> GateResult:
    failures = validate_events(
        ctx.events, today=ctx.today, sources=dict(ctx.source_specs)
    )
    if not failures:
        return GateResult(
            "final_schema", "pass", f"0 schema errors in {len(ctx.events)} events"
        )
    sample = "; ".join(
        f"{event_id}: {', '.join(reasons[:2])}"
        for event_id, reasons in list(failures.items())[:5]
    )
    return GateResult(
        "final_schema",
        "fail",
        f"{len(failures)} events have schema errors: {sample}",
    )


def gate_reject_rate(ctx: GateContext) -> GateResult:
    offenders = []
    for source_id, extracted in ctx.extracted_counts.items():
        if extracted <= 0:
            continue
        rejected = ctx.rejected_counts.get(source_id, 0)
        rate = rejected / extracted
        if rate > MAX_REJECT_RATE:
            offenders.append(
                f"{source_id}: {rejected}/{extracted} ({rate:.1%}) > "
                f"{MAX_REJECT_RATE:.0%}"
            )
    if offenders:
        return GateResult("reject_rate", "fail", "; ".join(offenders))
    return GateResult(
        "reject_rate",
        "pass",
        f"every source rejected at most {MAX_REJECT_RATE:.0%} of extracted records",
    )


def _expected_historical(
    seed_path: Path, source: SourceSpec
) -> tuple[int, str]:
    payload = json.loads(seed_path.read_text(encoding="utf-8"))
    rows: list[dict[str, Any]] = []
    for item in payload.get("events", []):
        name = normalize_text(item.get("name", ""))
        theme = Theme(str(item.get("category", "")))
        start_date = parse_date(item.get("date", ""))
        rows.append(
            {
                "event_id": event_id_for(source, theme, name, start_date, None),
                "name": name,
                "theme": theme.value,
                "kind": EventKind.HISTORICAL.value,
                "start_date": start_date.isoformat(),
                "start_time": None,
                "timezone": None,
                "all_day": True,
                "status": EventStatus.COMPLETED.value,
                "description": normalize_text(item.get("description", "")),
                "source_id": source.id,
                "external_id": None,
                "source_url": source.url,
                "verification": "curated",
                "supersedes": None,
            }
        )
    rows.sort(key=lambda row: row["event_id"])
    return len(rows), sha256_hex(canonical_json(rows))


def gate_historical(ctx: GateContext) -> GateResult:
    source = ctx.source_specs.get("historical_curated")
    if source is None:
        return GateResult("historical_immutable", "fail", "historical_curated missing")
    seed_path = seed_path_for(ctx.data_dir)
    if not seed_path.exists():
        return GateResult(
            "historical_immutable", "fail", f"historical seed missing: {seed_path.name}"
        )
    try:
        expected_count, expected_hash = _expected_historical(seed_path, source)
    except (OSError, json.JSONDecodeError, KeyError, ValueError) as exc:
        return GateResult(
            "historical_immutable",
            "fail",
            f"historical seed cannot be read: {type(exc).__name__}: {exc}",
        )
    historical = [
        event for event in ctx.events if event.kind is EventKind.HISTORICAL
    ]
    actual_hash = event_set_hash(historical)
    if len(historical) == expected_count and actual_hash == expected_hash:
        return GateResult(
            "historical_immutable",
            "pass",
            f"{expected_count} historical events match the curated seed",
        )
    if (
        ctx.previous_historical_source_sha256 is not None
        and ctx.previous_historical_source_sha256 != ctx.historical_source_sha256
    ):
        return GateResult(
            "historical_immutable",
            "pass",
            "historical_events.json changed since the previous bundle; "
            "the new seed was adopted",
        )
    return GateResult(
        "historical_immutable",
        "fail",
        f"historical set differs from the seed: {len(historical)} bundle events "
        f"vs {expected_count} seed events (hashes differ: "
        f"{actual_hash != expected_hash})",
    )


def gate_dates(ctx: GateContext) -> GateResult:
    bad = [
        event
        for event in ctx.events
        if event.kind is EventKind.UPCOMING
        and event.status in (EventStatus.SCHEDULED, EventStatus.TENTATIVE)
        and event.start_date < ctx.today
    ]
    if bad:
        sample = ", ".join(f"{event.event_id} ({event.start_date})" for event in bad[:5])
        return GateResult(
            "date_integrity",
            "fail",
            f"{len(bad)} active upcoming events are before today: {sample}",
        )
    exposed = [
        event
        for event in ctx.events
        if event.status is EventStatus.SCHEDULED and event.start_date < ctx.today
    ]
    if exposed:
        return GateResult(
            "date_integrity",
            "fail",
            f"{len(exposed)} past events are exposed as scheduled",
        )
    return GateResult(
        "date_integrity",
        "pass",
        "no active upcoming event is before today; no past event is scheduled",
    )


def gate_duplicates(ctx: GateContext) -> GateResult:
    ids: dict[str, int] = {}
    for event in ctx.events:
        ids[event.event_id] = ids.get(event.event_id, 0) + 1
    duplicate_ids = [value for value, count in ids.items() if count > 1]
    keys: dict[tuple[str, str, date], int] = {}
    for event in ctx.events:
        if event.status is not EventStatus.SCHEDULED:
            continue
        key = (event.theme.value, normalize_text(event.name).casefold(), event.start_date)
        keys[key] = keys.get(key, 0) + 1
    duplicate_keys = [key for key, count in keys.items() if count > 1]
    if duplicate_ids or duplicate_keys:
        reasons = []
        if duplicate_ids:
            reasons.append(f"duplicate event_id: {', '.join(duplicate_ids[:5])}")
        if duplicate_keys:
            reasons.append(
                "duplicate scheduled theme+name+date: "
                + "; ".join(f"{theme}:{name}:{day}" for theme, name, day in duplicate_keys[:5])
            )
        return GateResult("duplicate_integrity", "fail", " | ".join(reasons))
    return GateResult(
        "duplicate_integrity",
        "pass",
        "event ids and scheduled theme+name+date keys are unique",
    )


def gate_freshness(ctx: GateContext) -> GateResult:
    failures = []
    warnings = []
    for source_id, spec in ctx.source_specs.items():
        run = ctx.source_runs.get(source_id)
        if run is None:
            failures.append(f"{source_id}: no run record")
            continue
        if run.fetched_this_run:
            continue
        if run.last_success_at is None:
            failures.append(f"{source_id}: never fetched successfully")
            continue
        age = ctx.now - run.last_success_at
        if age > timedelta(days=spec.expected_freshness_days):
            failures.append(
                f"{source_id}: last success {iso_utc(run.last_success_at)} is older "
                f"than {spec.expected_freshness_days} days"
            )
        elif run.error:
            warnings.append(
                f"{source_id}: this run failed but the last success is within "
                f"{spec.expected_freshness_days} days ({run.error})"
            )
    if failures:
        return GateResult("source_freshness", "fail", "; ".join(failures))
    reason = f"all {len(ctx.source_specs)} enabled sources are fresh"
    if warnings:
        reason += "; " + "; ".join(warnings)
    return GateResult("source_freshness", "pass", reason)


def _active_upcoming_count(events: list[Event], theme: Theme) -> int:
    return sum(
        1
        for event in events
        if event.kind is EventKind.UPCOMING
        and event.theme is theme
        and event.status in (EventStatus.SCHEDULED, EventStatus.TENTATIVE)
    )


def gate_distribution(ctx: GateContext) -> GateResult:
    if not ctx.previous_manifest:
        return GateResult(
            "distribution_shift", "pass", "no previous bundle to compare"
        )
    previous_counts = ctx.previous_manifest.get("counts", {})
    warnings = []
    failures = []
    for theme in Theme:
        previous = 0
        theme_counts = previous_counts.get(theme.value, {}).get("upcoming", {})
        previous = int(theme_counts.get("scheduled", 0)) + int(
            theme_counts.get("tentative", 0)
        )
        current = _active_upcoming_count(ctx.events, theme)
        if previous < 5:
            warnings.append(f"{theme.value}: previous {previous} < 5 (warning only)")
            continue
        low = previous * 0.4
        high = previous * 1.6
        if current < low or current > high:
            failures.append(
                f"{theme.value}: {current} vs previous {previous} "
                f"(allowed {low:.0f}-{high:.0f})"
            )
    if failures:
        return GateResult("distribution_shift", "fail", "; ".join(failures))
    reason = "every theme within +/-60% of the previous bundle"
    if warnings:
        reason += "; " + "; ".join(warnings)
    return GateResult("distribution_shift", "pass", reason)


def gate_safety(ctx: GateContext) -> GateResult:
    bad_urls = [
        event.event_id
        for event in ctx.events
        if not is_https_url(event.source_url)
    ]
    findings = []
    for name, text in ctx.output_texts.items():
        for finding in find_secret_patterns(text):
            findings.append(f"{name}: {finding}")
    if bad_urls:
        return GateResult(
            "safety",
            "fail",
            f"{len(bad_urls)} source_url values are not https: "
            + ", ".join(bad_urls[:5]),
        )
    if findings:
        return GateResult("safety", "fail", "; ".join(findings[:5]))
    return GateResult(
        "safety",
        "pass",
        "no secret patterns in output files; every source_url is https",
    )


def run_gates(ctx: GateContext) -> list[GateResult]:
    """Run every gate even if an earlier one fails, so the report is complete."""

    return [
        gate_final_schema(ctx),
        gate_reject_rate(ctx),
        gate_historical(ctx),
        gate_dates(ctx),
        gate_duplicates(ctx),
        gate_freshness(ctx),
        gate_distribution(ctx),
        gate_safety(ctx),
    ]
