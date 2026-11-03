"""Human- and machine-readable quality reports."""

from __future__ import annotations

from datetime import date
from typing import Any, Iterable, Mapping

from .models import (
    THEME_METADATA,
    THEME_ORDER,
    Event,
    EventKind,
    EventStatus,
    SCHEMA_VERSION,
    SourceRun,
    iso_utc,
)


def _theme_manifest() -> dict[str, dict[str, Any]]:
    return {theme.value: dict(THEME_METADATA[theme]) for theme in THEME_ORDER}


def quality_report_payload(
    *,
    events: list[Event],
    source_runs: Mapping[str, SourceRun],
    gate_results: list[Any],
    today: date,
    bundle_version: str,
    summary: Mapping[str, int],
    notes: Iterable[str] = (),
    offline_build: bool = False,
) -> dict[str, Any]:
    upcoming_counts: dict[str, dict[str, int]] = {}
    for theme in THEME_ORDER:
        upcoming_counts[theme.value] = {}
        for horizon in (30, 90, 365):
            upcoming_counts[theme.value][str(horizon)] = sum(
                1
                for event in events
                if event.theme is theme
                and event.kind is EventKind.UPCOMING
                and event.status in (EventStatus.SCHEDULED, EventStatus.TENTATIVE)
                and today <= event.start_date
                and (event.start_date - today).days <= horizon
            )
    publishable = all(gate.status == "pass" for gate in gate_results) and not offline_build
    return {
        "schema_version": SCHEMA_VERSION,
        "as_of": today.isoformat(),
        "bundle_version": bundle_version,
        "test_build": offline_build,
        "publishable": publishable,
        "summary": dict(summary),
        "upcoming_counts": upcoming_counts,
        "gates": [
            {"id": gate.gate_id, "status": gate.status, "reason": gate.reason}
            for gate in gate_results
        ],
        "per_source": {
            source_id: {
                "records": run.record_count,
                "rejected": run.rejected_count,
                "fetched_this_run": run.fetched_this_run,
                "last_success_at": (
                    iso_utc(run.last_success_at) if run.last_success_at else None
                ),
                "error": run.error,
            }
            for source_id, run in source_runs.items()
        },
        "theme_metadata": _theme_manifest(),
        "notes": list(notes),
    }


def quality_report_markdown(report: Mapping[str, Any]) -> str:
    summary = report["summary"]
    lines = []
    if report.get("test_build"):
        lines.extend(["TEST BUILD (offline fixtures), never publishable", ""])
    lines.extend(
        [
            "# Events bundle quality report",
            "",
            f"As of {report['as_of']}. Bundle version `{report['bundle_version']}`. "
            f"Publishable: **{'yes' if report['publishable'] else 'no'}**.",
            "",
            "## Summary",
            "",
            f"- Records extracted: {summary.get('events_discovered', 0)}",
            f"- Events added or updated: {summary.get('events_updated', 0)}",
            f"- Records rejected: {summary.get('events_rejected', 0)}",
            f"- Duplicates removed: {summary.get('duplicates_removed', 0)}",
            f"- Events in bundle: {summary.get('events_total', 0)} "
            f"({summary.get('historical_total', 0)} historical, "
            f"{summary.get('upcoming_total', 0)} upcoming)",
            "",
            "## Upcoming events by theme",
            "",
            "Scheduled and tentative events only.",
            "",
            "| Theme | Next 30 days | Next 90 days | Next 365 days |",
            "|---|---:|---:|---:|",
        ]
    )
    for theme, counts in report["upcoming_counts"].items():
        lines.append(
            f"| {theme} | {counts['30']} | {counts['90']} | {counts['365']} |"
        )
    lines.extend(["", "## Gates", "", "| Gate | Result | Reason |", "|---|---|---|"])
    for gate in report["gates"]:
        reason = str(gate["reason"]).replace("|", "\\|")
        lines.append(f"| {gate['id']} | {gate['status']} | {reason} |")
    lines.extend(
        [
            "",
            "## Sources",
            "",
            "| Source | Records | Rejected | Fetched this run | Error |",
            "|---|---:|---:|---|---|",
        ]
    )
    for source_id, source in report["per_source"].items():
        error = str(source.get("error") or "").replace("|", "\\|")
        lines.append(
            f"| {source_id} | {source['records']} | {source['rejected']} | "
            f"{'yes' if source['fetched_this_run'] else 'no'} | {error} |"
        )
    if report.get("notes"):
        lines.extend(["", "## Notes", ""])
        lines.extend(f"- {note}" for note in report["notes"])
    return "\n".join(lines) + "\n"
