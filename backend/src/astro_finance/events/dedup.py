"""Deduplicate records that describe the same real-world event."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Iterable, Mapping

from .models import (
    Event,
    EventKind,
    RELIABILITY_RANK,
    Reliability,
    VERIFICATION_RANK,
    sort_events,
)
from .text import normalize_text


@dataclass(frozen=True, slots=True)
class DedupResult:
    events: list[Event]
    duplicates: int
    dropped: tuple[Event, ...]


def _quality_key(
    event: Event, reliability_by_source: Mapping[str, Reliability]
) -> tuple[int, int, int, str]:
    # Historical first, then source reliability, then verification strength.
    return (
        0 if event.kind is EventKind.HISTORICAL else 1,
        -RELIABILITY_RANK.get(
            reliability_by_source.get(event.source_id, Reliability.MEDIUM), 0
        ),
        -VERIFICATION_RANK.get(event.verification, 0),
        event.event_id,
    )


def _same_day_window(left: Event, right: Event) -> bool:
    if left.start_date == right.start_date:
        return True
    if left.all_day and right.all_day:
        return abs((left.start_date - right.start_date).days) <= 1
    return False


def deduplicate(
    events: Iterable[Event],
    reliability_by_source: Mapping[str, Reliability] | None = None,
) -> DedupResult:
    """Keep the best record for each theme + normalised name + date.

    ``±1 day`` only applies when both records are all-day, because two timed
    events a day apart are genuinely different occurrences.  The first record
    in quality order wins; a lower-quality record is never written over it.
    """

    reliability = reliability_by_source or {}
    ordered = sorted(events, key=lambda event: _quality_key(event, reliability))
    accepted: list[Event] = []
    index: dict[tuple[str, str], list[Event]] = {}
    dropped: list[Event] = []
    seen_ids: set[str] = set()

    for candidate in ordered:
        if candidate.event_id in seen_ids:
            dropped.append(candidate)
            continue
        key = (candidate.theme.value, normalize_text(candidate.name).casefold())
        matches = [
            existing
            for existing in index.get(key, [])
            if _same_day_window(existing, candidate)
        ]
        if matches:
            dropped.append(candidate)
            continue
        accepted.append(candidate)
        seen_ids.add(candidate.event_id)
        index.setdefault(key, []).append(candidate)

    return DedupResult(
        events=sort_events(accepted),
        duplicates=len(dropped),
        dropped=tuple(dropped),
    )


def duplicate_key(event: Event) -> tuple[str, str, date]:
    return (event.theme.value, normalize_text(event.name).casefold(), event.start_date)
