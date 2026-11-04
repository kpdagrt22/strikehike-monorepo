from __future__ import annotations

from datetime import timedelta

from astro_finance.events.lifecycle import (
    archive_event_id,
    base_event_id,
    merge_with_previous,
)
from astro_finance.events.models import EventKind, EventStatus
from conftest import NOW, TODAY, build_event


def _merge(current, previous, *, successful=None, changed=False, available=None):
    return merge_with_previous(
        current,
        previous,
        today=TODAY,
        now=NOW,
        successful_source_ids=(
            {"test_source"} if successful is None else successful
        ),
        historical_source_changed=changed,
        available_source_ids=available,
    )


def _by_base(events, base):
    return [event for event in events if base_event_id(event.event_id) == base]


def test_new_event_becomes_scheduled():
    event = build_event(event_id="science:test_source:new-2027")
    result = _merge([event], [])
    assert len(result.events) == 1
    assert result.events[0].status is EventStatus.SCHEDULED
    assert result.added_ids == (event.event_id,)


def test_unchanged_event_keeps_its_original_timestamps():
    previous = build_event(
        event_id="science:test_source:same-2027",
        first=NOW - timedelta(days=30),
        last=NOW - timedelta(days=30),
        collected=NOW - timedelta(days=30),
    )
    current = build_event(
        event_id="science:test_source:same-2027",
        first=NOW,
        last=NOW,
        collected=NOW,
    )
    result = _merge([current], [previous])
    assert result.events[0] == previous
    assert result.updated_count == 0


def test_reschedule_archives_the_old_record_and_links_supersedes():
    base = "science:test_source:move-2027"
    previous = build_event(event_id=base, start_date=TODAY + timedelta(days=10))
    current = build_event(event_id=base, start_date=TODAY + timedelta(days=20))
    result = _merge([current], [previous])
    family = _by_base(result.events, base)
    assert len(family) == 2
    archived = next(event for event in family if event.event_id != base)
    moved = next(event for event in family if event.event_id == base)
    assert archived.status is EventStatus.RESCHEDULED
    assert archived.start_date == previous.start_date
    assert moved.status is EventStatus.SCHEDULED
    assert moved.supersedes == archived.event_id
    assert moved.start_date == current.start_date


def test_repeated_reschedules_keep_every_snapshot_and_unique_ids():
    base = "science:test_source:move-2027"
    first = _merge(
        [build_event(event_id=base, start_date=TODAY + timedelta(days=10))], []
    )
    second = _merge(
        [build_event(event_id=base, start_date=TODAY + timedelta(days=20))],
        first.events,
    )
    third = _merge(
        [build_event(event_id=base, start_date=TODAY + timedelta(days=30))],
        second.events,
    )
    assert len(_by_base(third.events, base)) == 3
    assert len({event.event_id for event in third.events}) == 3


def test_cancelled_status_is_applied_in_place():
    base = "science:test_source:cancel-2027"
    previous = build_event(event_id=base, start_date=TODAY + timedelta(days=10))
    current = build_event(
        event_id=base,
        start_date=previous.start_date,
        status=EventStatus.CANCELLED,
    )
    result = _merge([current], [previous])
    assert len(_by_base(result.events, base)) == 1
    assert result.events[0].status is EventStatus.CANCELLED


def test_a_past_scheduled_event_becomes_completed():
    base = "science:test_source:past-2026"
    previous = build_event(
        event_id=base,
        start_date=TODAY - timedelta(days=1),
    )
    result = _merge([], [previous])
    assert result.events[0].status is EventStatus.COMPLETED


def test_missing_once_keeps_scheduled_and_twice_unverifies():
    base = "science:test_source:miss-2027"
    previous = build_event(event_id=base, start_date=TODAY + timedelta(days=10))
    first = _merge([], [previous])
    assert first.events[0].status is EventStatus.SCHEDULED
    assert first.events[0].missing_runs == 1
    second = _merge([], first.events)
    assert second.events[0].status is EventStatus.UNVERIFIED
    assert second.events[0].missing_runs == 2
    third = _merge([], second.events)
    assert third.events[0].status is EventStatus.UNVERIFIED
    assert third.events[0].missing_runs == 2


def test_missing_count_does_not_advance_when_the_source_failed():
    base = "science:test_source:failed-2027"
    previous = build_event(event_id=base, start_date=TODAY + timedelta(days=10))
    result = _merge([], [previous], successful=set())
    assert result.events[0] == previous


def test_removed_source_is_retired_in_the_same_run():
    base = "science:removed_source:gone-2027"
    previous = build_event(
        event_id=base,
        source_id="removed_source",
        start_date=TODAY + timedelta(days=10),
    )
    result = _merge([], [previous], successful=set(), available={"test_source"})
    assert result.events[0].status is EventStatus.UNVERIFIED
    assert result.events[0].missing_runs == 2
    assert result.retired_ids == (base,)


def test_returning_event_resets_missing_state():
    base = "science:test_source:return-2027"
    previous = build_event(
        event_id=base,
        start_date=TODAY + timedelta(days=10),
        status=EventStatus.UNVERIFIED,
        missing_runs=2,
    )
    current = build_event(event_id=base, start_date=previous.start_date)
    result = _merge([current], [previous])
    assert result.events[0].status is EventStatus.SCHEDULED
    assert result.events[0].missing_runs == 0


def test_historical_event_is_immutable_while_seed_is_unchanged():
    base = "science:historical_curated:old-2000"
    previous = build_event(
        event_id=base,
        kind=EventKind.HISTORICAL,
        description="old description",
    )
    current = build_event(
        event_id=base,
        kind=EventKind.HISTORICAL,
        description="new description",
    )
    result = _merge([current], [previous], changed=False)
    assert result.events[0].description == "old description"


def test_changed_historical_seed_is_adopted_and_removals_apply():
    kept = "science:historical_curated:kept-2000"
    removed = "science:historical_curated:removed-2000"
    previous = [
        build_event(event_id=kept, kind=EventKind.HISTORICAL, description="old"),
        build_event(event_id=removed, kind=EventKind.HISTORICAL),
    ]
    current = [
        build_event(event_id=kept, kind=EventKind.HISTORICAL, description="new"),
    ]
    result = _merge(current, previous, changed=True)
    assert [event.event_id for event in result.events] == [kept]
    assert result.events[0].description == "new"


def test_archive_id_is_deterministic_and_unique():
    used = {"science:test_source:event-2027@2026-11-13"}
    first = archive_event_id(
        "science:test_source:event-2027", TODAY, used
    )
    assert first == "science:test_source:event-2027@2026-11-03"
    used.add(first)
    second = archive_event_id(
        "science:test_source:event-2027", TODAY, used
    )
    assert second.endswith("~2")
