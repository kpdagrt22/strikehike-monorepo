"""Deterministic merge of this run's events with the previous bundle.

The merge is append-only: nothing is deleted, historical events never change
unless their curated seed file changed, and a moved event is archived as a
``rescheduled`` snapshot while the canonical id moves to the new date.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from typing import Iterable

from .models import (
    Event,
    EventKind,
    EventStatus,
    replace_event,
    sort_events,
)

ARCHIVE_SEPARATOR = "@"


@dataclass(frozen=True, slots=True)
class LifecycleResult:
    events: list[Event]
    updated_count: int
    added_ids: tuple[str, ...]
    changed_ids: tuple[str, ...]
    retired_ids: tuple[str, ...] = ()


def base_event_id(event_id: str) -> str:
    """Strip an archive suffix so a moved event still matches its identity."""

    return event_id.split(ARCHIVE_SEPARATOR, 1)[0]


def archive_event_id(base: str, old_date: date, used: set[str]) -> str:
    """Deterministic id for a superseded snapshot; unique even on a re-move."""

    candidate = f"{base}{ARCHIVE_SEPARATOR}{old_date.isoformat()}"
    if candidate not in used:
        return candidate
    suffix = 2
    while f"{candidate}~{suffix}" in used:
        suffix += 1
    return f"{candidate}~{suffix}"


def _active(records: Iterable[Event]) -> Event | None:
    active = [
        record
        for record in records
        if record.status in (EventStatus.SCHEDULED, EventStatus.TENTATIVE)
    ]
    if not active:
        return None
    return max(active, key=lambda record: (record.last_updated_at, record.event_id))


def _same_date_merge(target: Event, incoming: Event, now: datetime) -> Event:
    content_changes = {
        "name": incoming.name,
        "theme": incoming.theme,
        "kind": incoming.kind,
        "start_date": incoming.start_date,
        "start_time": incoming.start_time,
        "timezone": incoming.timezone,
        "all_day": incoming.all_day,
        "status": incoming.status,
        "description": incoming.description,
        "source_id": incoming.source_id,
        "external_id": incoming.external_id,
        "source_url": incoming.source_url,
        "verification": incoming.verification,
        "supersedes": target.supersedes or incoming.supersedes,
        "days_until": None,
        "missing_runs": 0,
        "first_discovered_at": target.first_discovered_at,
        "last_updated_at": target.last_updated_at,
        "collected_at": target.collected_at,
    }
    candidate = replace_event(target, **content_changes)
    if candidate.content_hash == target.content_hash:
        return target
    return replace_event(
        target,
        **{**content_changes, "last_updated_at": now, "collected_at": now},
    )


def _cancelled_merge(target: Event, incoming: Event, now: datetime) -> Event:
    if target.status is EventStatus.COMPLETED:
        return target
    return replace_event(
        target,
        name=incoming.name,
        theme=incoming.theme,
        kind=incoming.kind,
        start_date=incoming.start_date,
        start_time=incoming.start_time,
        timezone=incoming.timezone,
        all_day=incoming.all_day,
        status=EventStatus.CANCELLED,
        description=incoming.description,
        source_id=incoming.source_id,
        external_id=incoming.external_id,
        source_url=incoming.source_url,
        verification=incoming.verification,
        supersedes=target.supersedes or incoming.supersedes,
        missing_runs=0,
        days_until=None,
        last_updated_at=now,
        collected_at=now,
    )


def merge_with_previous(
    current: list[Event],
    previous: list[Event],
    *,
    today: date,
    now: datetime,
    successful_source_ids: set[str],
    historical_source_changed: bool,
    available_source_ids: set[str] | None = None,
) -> LifecycleResult:
    """Apply the lifecycle rules and return the complete, sorted set."""

    available = (
        available_source_ids
        if available_source_ids is not None
        else {event.source_id for event in previous}
    )
    retired_ids: list[str] = []
    previous_by_id = {event.event_id: event for event in previous}
    used_ids: set[str] = set(previous_by_id)
    consumed_previous: set[str] = set()
    output: list[Event] = []
    historical_ids: set[str] = set()

    # Historical records are immutable until the curated seed itself changes.
    # A changed seed is an explicit owner edit: adopt its set exactly, while
    # preserving first_discovered_at for events that were already present.
    previous_historical = {
        event.event_id: event
        for event in previous
        if event.kind is EventKind.HISTORICAL
    }
    current_historical = [
        event for event in current if event.kind is EventKind.HISTORICAL
    ]
    if previous_historical and historical_source_changed:
        for new in current_historical:
            old = previous_historical.get(new.event_id)
            if old is None:
                output.append(new)
                used_ids.add(new.event_id)
            else:
                output.append(
                    replace_event(
                        old,
                        name=new.name,
                        description=new.description,
                        source_url=new.source_url,
                        verification=new.verification,
                        last_updated_at=now,
                        collected_at=now,
                    )
                )
            historical_ids.add(new.event_id)
    else:
        for old in previous_historical.values():
            output.append(old)
            historical_ids.add(old.event_id)
        for new in current_historical:
            if new.event_id not in historical_ids:
                output.append(new)
                historical_ids.add(new.event_id)
                used_ids.add(new.event_id)

    previous_upcoming = [
        event for event in previous if event.kind is EventKind.UPCOMING
    ]
    previous_by_base: dict[str, list[Event]] = {}
    for old in previous_upcoming:
        previous_by_base.setdefault(base_event_id(old.event_id), []).append(old)

    for incoming in current:
        if incoming.kind is not EventKind.UPCOMING:
            continue
        base = incoming.event_id
        family = previous_by_base.get(base, [])
        canonical = previous_by_id.get(base)
        target = _active(family) or canonical

        if target is None:
            used_ids.add(base)
            output.append(
                replace_event(
                    incoming,
                    event_id=base,
                    last_updated_at=now,
                    collected_at=now,
                    missing_runs=0,
                )
            )
            continue

        consumed_previous.add(target.event_id)

        if incoming.status is EventStatus.CANCELLED:
            output.append(_cancelled_merge(target, incoming, now))
            continue

        if target.start_date == incoming.start_date:
            output.append(_same_date_merge(target, incoming, now))
            continue

        archived_status = {
            EventStatus.SCHEDULED: EventStatus.RESCHEDULED,
            EventStatus.TENTATIVE: EventStatus.RESCHEDULED,
            EventStatus.UNVERIFIED: EventStatus.UNVERIFIED,
            EventStatus.CANCELLED: EventStatus.CANCELLED,
            EventStatus.COMPLETED: EventStatus.COMPLETED,
            EventStatus.RESCHEDULED: EventStatus.RESCHEDULED,
        }[target.status]
        archived_id = archive_event_id(base, target.start_date, used_ids)
        used_ids.add(archived_id)
        output.append(
            replace_event(
                target,
                event_id=archived_id,
                status=archived_status,
                last_updated_at=now,
                collected_at=now,
                days_until=None,
            )
        )
        output.append(
            replace_event(
                incoming,
                event_id=base,
                supersedes=archived_id,
                first_discovered_at=target.first_discovered_at,
                last_updated_at=now,
                collected_at=now,
                missing_runs=0,
            )
        )

    # Previous records that the source did not return this run.
    for old in previous_upcoming:
        if old.event_id in consumed_previous:
            continue
        if base_event_id(old.event_id) != old.event_id:
            output.append(old)  # archived snapshots are never revisited
            continue
        if old.source_id not in available:
            if old.status in (EventStatus.SCHEDULED, EventStatus.TENTATIVE, EventStatus.UNVERIFIED):
                status = (
                    EventStatus.COMPLETED
                    if old.start_date < today
                    else EventStatus.UNVERIFIED
                )
                output.append(
                    replace_event(
                        old,
                        status=status,
                        missing_runs=2,
                        last_updated_at=now,
                        collected_at=now,
                    )
                )
                retired_ids.append(old.event_id)
            else:
                output.append(old)
            continue
        if old.source_id not in successful_source_ids:
            output.append(old)  # a failed source must not erase confidence
            continue
        if old.status in (EventStatus.SCHEDULED, EventStatus.TENTATIVE):
            if old.start_date < today:
                output.append(
                    replace_event(
                        old,
                        status=EventStatus.COMPLETED,
                        last_updated_at=now,
                        collected_at=now,
                    )
                )
            else:
                misses = old.missing_runs + 1
                status = (
                    EventStatus.UNVERIFIED if misses >= 2 else old.status
                )
                output.append(
                    replace_event(
                        old,
                        status=status,
                        missing_runs=misses,
                        last_updated_at=now,
                        collected_at=now,
                    )
                )
        elif old.status is EventStatus.UNVERIFIED:
            output.append(
                replace_event(
                    old,
                    missing_runs=min(2, old.missing_runs + 1),
                )
            )
        else:
            output.append(old)

    # Completion sweep for anything still exposed as scheduled.
    completed: list[Event] = []
    for event in output:
        if (
            event.kind is EventKind.UPCOMING
            and event.status in (EventStatus.SCHEDULED, EventStatus.TENTATIVE)
            and event.start_date < today
        ):
            completed.append(
                replace_event(
                    event,
                    status=EventStatus.COMPLETED,
                    last_updated_at=now,
                    collected_at=now,
                )
            )
        else:
            completed.append(event)

    viewed_ids: set[str] = set()
    for event in completed:
        if event.event_id in viewed_ids:
            raise ValueError(f"lifecycle produced duplicate event_id {event.event_id!r}")
        viewed_ids.add(event.event_id)

    result = sort_events(completed)
    added = tuple(
        event.event_id for event in result if event.event_id not in previous_by_id
    )
    changed = tuple(
        event.event_id
        for event in result
        if event.event_id in previous_by_id
        and event.content_hash != previous_by_id[event.event_id].content_hash
    )
    return LifecycleResult(
        events=result,
        updated_count=len(set(added) | set(changed)),
        added_ids=added,
        changed_ids=changed,
        retired_ids=tuple(retired_ids),
    )
