"""Normalise source records and validate the canonical event set."""

from __future__ import annotations

import re
from datetime import date, datetime, time, timedelta
from typing import Any

from .models import (
    Event,
    EventKind,
    EventStatus,
    RawRecord,
    Theme,
    Verification,
    make_event,
    sha256_hex,
    canonical_json,
)
from .registry import SourceSpec
from .text import (
    is_https_url,
    normalize_text,
    parse_date,
    parse_time,
    slugify,
    validate_timezone,
)

MAX_UPCOMING_DAYS = 400
_EXTERNAL_ID_RE = re.compile(r"[^A-Za-z0-9._-]+")


class NormalizationError(ValueError):
    """Raised with every reason a raw record could not become an event."""

    def __init__(self, reasons: list[str]) -> None:
        super().__init__("; ".join(reasons))
        self.reasons = reasons


def _external_fragment(value: str | None) -> str | None:
    if not value:
        return None
    return _EXTERNAL_ID_RE.sub("-", normalize_text(value)).strip("-") or None


def event_id_for(
    source: SourceSpec,
    theme: Theme,
    name: str,
    start_date: date,
    external_id: str | None,
) -> str:
    """Stable id: external id when the source supplies one, else name + year.

    The year (not the full date) is deliberate: a rescheduled event in the same
    year keeps its identity, which is what the lifecycle merge keys on.
    """

    fragment = _external_fragment(external_id)
    if fragment:
        return f"{theme.slug}:{source.id}:{fragment}"
    return f"{theme.slug}:{source.id}:{slugify(name)}:{start_date.year}"


def normalize_raw(
    raw: RawRecord,
    source: SourceSpec,
    *,
    today: date,
    now: datetime,
) -> Event:
    """Convert one raw record; raises :class:`NormalizationError` on bad data."""

    reasons: list[str] = []
    if not isinstance(raw.name, str):
        reasons.append("name must be a string")
    if not isinstance(raw.start_date, str):
        reasons.append("start_date must be a string")
    if not isinstance(raw.all_day, bool):
        reasons.append("all_day must be a boolean")
    name = normalize_text(raw.name)
    if not name:
        reasons.append("name is empty")
    try:
        theme = Theme(normalize_text(raw.theme))
    except ValueError:
        theme = None  # type: ignore[assignment]
        reasons.append(f"unknown theme: {raw.theme!r}")
    if theme is not None and theme not in source.themes:
        reasons.append(f"theme {theme.value!r} is not declared by source {source.id!r}")

    try:
        start_date = parse_date(raw.start_date)
    except ValueError as exc:
        start_date = None  # type: ignore[assignment]
        reasons.append(str(exc))

    try:
        start_time = parse_time(raw.start_time) if raw.start_time else None
    except ValueError as exc:
        start_time = None
        reasons.append(str(exc))

    try:
        timezone_name = validate_timezone(raw.timezone)
    except ValueError as exc:
        timezone_name = None
        reasons.append(str(exc))

    try:
        status = EventStatus(normalize_text(raw.status))
    except ValueError:
        status = None  # type: ignore[assignment]
        reasons.append(f"unknown status: {raw.status!r}")
    try:
        kind = EventKind(normalize_text(raw.kind))
    except ValueError:
        kind = None  # type: ignore[assignment]
        reasons.append(f"unknown kind: {raw.kind!r}")
    try:
        verification = Verification(
            normalize_text(raw.verification or source.verification.value)
        )
    except ValueError:
        verification = None  # type: ignore[assignment]
        reasons.append(f"unknown verification: {raw.verification!r}")

    if start_time is not None and bool(raw.all_day):
        reasons.append("all_day events must not carry a start_time")
    if not bool(raw.all_day) and start_time is None:
        reasons.append("timed events require a start_time")
    if not bool(raw.all_day) and timezone_name is None:
        reasons.append("timed events require an IANA timezone")

    source_url = normalize_text(raw.source_url or source.url)
    if not is_https_url(source_url):
        reasons.append(f"source_url must be an absolute https URL: {source_url!r}")

    if reasons:
        raise NormalizationError(reasons)

    assert start_date is not None and theme is not None and status is not None
    assert kind is not None and verification is not None

    external_id = normalize_text(raw.external_id) if raw.external_id else None
    event_id = event_id_for(source, theme, name, start_date, external_id)
    return make_event(
        event_id=event_id,
        name=name,
        theme=theme,
        kind=kind,
        start_date=start_date,
        start_time=start_time,
        timezone=timezone_name,
        all_day=bool(raw.all_day),
        status=status,
        description=normalize_text(raw.description),
        source_id=source.id,
        external_id=external_id,
        source_url=source_url,
        first_discovered_at=now,
        last_updated_at=now,
        collected_at=now,
        verification=verification,
        supersedes=raw.supersedes,
        days_until=None,
        missing_runs=0,
    )


def validate_event(
    event: Event,
    *,
    today: date,
    source: SourceSpec | None = None,
) -> list[str]:
    """Return every schema or window problem with one event."""

    reasons: list[str] = []
    if not isinstance(event.event_id, str) or not event.event_id:
        reasons.append("event_id is empty")
    if not isinstance(event.name, str) or not event.name:
        reasons.append("name is empty")
    if not isinstance(event.start_date, date):
        reasons.append("start_date must be a date")
        return reasons
    if not isinstance(event.all_day, bool):
        reasons.append("all_day must be a boolean")
    if not isinstance(event.description, str):
        reasons.append("description must be a string")
    if not isinstance(event.source_url, str):
        reasons.append("source_url must be a string")
        return reasons
    if event.start_time is not None and not isinstance(event.start_time, time):
        reasons.append("start_time must be a time or null")
        return reasons
    if not event.source_id:
        reasons.append("source_id is empty")
    if not is_https_url(event.source_url):
        reasons.append(f"source_url must be an absolute https URL: {event.source_url!r}")
    if event.timezone:
        try:
            validate_timezone(event.timezone)
        except ValueError as exc:
            reasons.append(str(exc))
    if event.all_day and event.start_time is not None:
        reasons.append("all_day event has a start_time")
    if not event.all_day and event.start_time is None:
        reasons.append("timed event is missing start_time")
    if not event.all_day and not event.timezone:
        reasons.append("timed event is missing timezone")
    if event.kind is EventKind.HISTORICAL:
        if event.start_date > today:
            reasons.append("historical event is in the future")
        if event.status is not EventStatus.COMPLETED:
            reasons.append("historical event must have status completed")
    if event.kind is EventKind.UPCOMING:
        if event.status in (EventStatus.SCHEDULED, EventStatus.TENTATIVE):
            if event.start_date < today:
                reasons.append("upcoming event is before today")
            if event.start_date > today + timedelta(days=MAX_UPCOMING_DAYS):
                reasons.append(
                    f"upcoming event is beyond today + {MAX_UPCOMING_DAYS} days"
                )
    if source is not None and event.theme not in source.themes:
        reasons.append(f"theme {event.theme.value!r} is not declared by {source.id!r}")
    expected_hash = sha256_hex(canonical_json(event.content_dict()))
    if event.content_hash and event.content_hash != expected_hash:
        reasons.append("content_hash does not match content")
    return reasons


def validate_events(
    events: list[Event], *, today: date, sources: dict[str, SourceSpec]
) -> dict[str, list[str]]:
    """Validate a whole set; returns ``{event_id: reasons}`` for failures."""

    failures: dict[str, list[str]] = {}
    for event in events:
        source = sources.get(event.source_id)
        if source is None:
            # A retired event from a removed source is retained but hidden;
            # it must still keep a valid shape.  Active events cannot survive
            # without an enabled source.
            if event.status in (
                EventStatus.UNVERIFIED,
                EventStatus.COMPLETED,
                EventStatus.CANCELLED,
                EventStatus.RESCHEDULED,
            ):
                reasons = validate_event(event, today=today)
                if reasons:
                    failures[event.event_id] = reasons
                continue
            failures[event.event_id] = [
                f"source_id {event.source_id!r} is not an enabled source"
            ]
            continue
        reasons = validate_event(event, today=today, source=source)
        if reasons:
            failures[event.event_id] = reasons
    return failures


def event_set_hash(events: list[Event]) -> str:
    """Combined hash used by the historical immutability gate.

    Sorting by id makes the hash independent of bundle display order.
    """

    rows = [
        event.content_dict()
        for event in sorted(events, key=lambda item: item.event_id)
    ]
    return sha256_hex(canonical_json(rows))


def reject_payload(
    raw: RawRecord, reasons: list[str], *, now: datetime
) -> dict[str, Any]:
    return {
        "source_id": raw.source_id,
        "name": raw.name,
        "start_date": raw.start_date,
        "reasons": reasons,
        "rejected_at": now.isoformat(),
    }
