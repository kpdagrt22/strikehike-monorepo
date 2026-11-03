"""Load owner-curated upcoming events from ``data/events/curated/*.toml``."""

from __future__ import annotations

import tomllib
from datetime import date, datetime
from pathlib import Path
from typing import Any

from ..models import EventKind, EventStatus, RawRecord, Theme, Verification
from ..registry import SourceSpec
from ..text import is_https_url, normalize_text, parse_date, parse_time, validate_timezone
from . import SourceExtraction, SourceReject

ALLOWED_STATUSES = (
    EventStatus.SCHEDULED,
    EventStatus.TENTATIVE,
    EventStatus.CANCELLED,
)


def _clean_entry(
    source: SourceSpec,
    entry: Any,
    *,
    today: date,
) -> tuple[RawRecord | None, list[str]]:
    reasons: list[str] = []
    if not isinstance(entry, dict):
        return None, ["entry is not a TOML table"]

    for key in ("theme", "name", "date", "source_url", "verified_on", "status"):
        if not normalize_text(entry.get(key, "")):
            reasons.append(f"missing required field {key!r}")

    theme: Theme | None = None
    try:
        theme = Theme(normalize_text(entry.get("theme", "")))
    except ValueError:
        reasons.append(f"unknown theme: {entry.get('theme')!r}")
    if theme is not None and theme not in source.themes:
        reasons.append(f"theme {theme.value!r} is not allowed for curated_upcoming")

    status: EventStatus | None = None
    try:
        status = EventStatus(normalize_text(entry.get("status", "")))
    except ValueError:
        reasons.append(f"unknown status: {entry.get('status')!r}")
    if status is not None and status not in ALLOWED_STATUSES:
        reasons.append(
            f"curated status must be one of "
            f"{', '.join(item.value for item in ALLOWED_STATUSES)}"
        )

    parsed_date: date | None = None
    try:
        parsed_date = parse_date(entry.get("date", ""))
    except ValueError as exc:
        reasons.append(str(exc))

    verified_on: date | None = None
    try:
        verified_on = parse_date(entry.get("verified_on", ""))
    except ValueError as exc:
        reasons.append(f"verified_on: {exc}")
    if verified_on is not None and verified_on > today:
        reasons.append("verified_on is in the future")

    source_url = normalize_text(entry.get("source_url", ""))
    if source_url and not is_https_url(source_url):
        reasons.append("source_url must be an absolute https URL")

    time_value = entry.get("time")
    parsed_time = None
    if time_value:
        try:
            parsed_time = parse_time(time_value)
        except ValueError as exc:
            reasons.append(str(exc))

    timezone_value = entry.get("timezone")
    timezone_name = None
    if timezone_value:
        try:
            timezone_name = validate_timezone(str(timezone_value))
        except ValueError as exc:
            reasons.append(str(exc))
    if parsed_time is not None and timezone_name is None:
        reasons.append("a timed curated event requires an IANA timezone")

    if reasons:
        return None, reasons
    assert theme is not None and status is not None and parsed_date is not None

    return (
        RawRecord(
            source_id=source.id,
            name=normalize_text(entry.get("name", "")),
            theme=theme.value,
            start_date=parsed_date.isoformat(),
            description=normalize_text(entry.get("description", "")),
            external_id=normalize_text(entry.get("external_id", "")) or None,
            start_time=parsed_time.isoformat(timespec="seconds") if parsed_time else None,
            timezone=timezone_name,
            all_day=parsed_time is None,
            status=status.value,
            source_url=source_url,
            verification=Verification.CURATED.value,
            kind=EventKind.UPCOMING.value,
        ),
        [],
    )


def extract(
    source: SourceSpec,
    *,
    today: date,
    now: datetime,
    data_dir: Path,
) -> SourceExtraction:
    curated_dir = data_dir / "curated"
    records: list[RawRecord] = []
    rejects: list[SourceReject] = []
    raw_payloads: dict[str, bytes] = {}
    if not curated_dir.exists():
        return SourceExtraction(
            source_id=source.id,
            records=(),
            raw_payloads={},
            fetched_at=now,
        )

    for path in sorted(curated_dir.glob("*.toml")):
        raw_bytes = path.read_bytes()
        raw_payloads[path.name] = raw_bytes
        try:
            payload = tomllib.loads(raw_bytes.decode("utf-8"))
        except (UnicodeDecodeError, tomllib.TOMLDecodeError) as exc:
            rejects.append(
                SourceReject(
                    source_id=source.id,
                    raw={"file": path.name},
                    reasons=(f"invalid TOML: {exc}",),
                )
            )
            continue
        entries = payload.get("events", [])
        if not isinstance(entries, list):
            rejects.append(
                SourceReject(
                    source_id=source.id,
                    raw={"file": path.name},
                    reasons=("'events' must be an array of tables",),
                )
            )
            continue
        for index, entry in enumerate(entries):
            record, reasons = _clean_entry(source, entry, today=today)
            if record is None:
                rejects.append(
                    SourceReject(
                        source_id=source.id,
                        raw={"file": path.name, "index": index, "entry": entry},
                        reasons=tuple(reasons),
                    )
                )
            else:
                records.append(record)

    return SourceExtraction(
        source_id=source.id,
        records=tuple(records),
        raw_payloads=raw_payloads,
        fetched_at=now,
        rejects=tuple(rejects),
    )
