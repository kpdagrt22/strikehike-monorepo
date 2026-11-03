from __future__ import annotations

from datetime import date, time, timedelta, timezone

from astro_finance.events.bundle import bundle_version_for
from astro_finance.events.models import (
    Event,
    EventKind,
    EventStatus,
    Theme,
    canonical_json,
    event_sort_key,
    iso_utc,
    sha256_hex,
    sort_events,
)
from conftest import NOW, TODAY, build_event


def test_theme_values_and_slugs_are_exact():
    assert [theme.value for theme in Theme] == [
        "Politics",
        "Science",
        "Finance",
        "Culture/Religion",
        "Natural Disasters",
    ]
    assert [theme.slug for theme in Theme] == [
        "politics",
        "science",
        "finance",
        "culture-religion",
        "natural-disasters",
    ]


def test_event_round_trip_preserves_content():
    event = build_event(
        start_time=time(9, 30),
        timezone_name="Asia/Kolkata",
        all_day=False,
        days_until=12,
        missing_runs=1,
    )
    restored = Event.from_dict(event.to_dict())
    assert restored == event
    assert restored.to_dict() == event.to_dict()


def test_content_hash_ignores_run_timestamps_and_derived_fields():
    event = build_event()
    changed = build_event(
        collected=NOW + timedelta(days=1),
        last=NOW + timedelta(days=1),
        first=NOW - timedelta(days=1),
        days_until=99,
        missing_runs=2,
    )
    assert event.content_hash == changed.content_hash
    assert event.content_dict() == changed.content_dict()


def test_content_hash_changes_when_facts_change():
    event = build_event()
    moved = build_event(start_date=event.start_date + timedelta(days=1))
    assert event.content_hash != moved.content_hash


def test_iso_utc_uses_z_suffix():
    assert iso_utc(NOW) == "2026-11-03T12:00:00Z"


def test_canonical_json_is_stable():
    assert canonical_json({"b": 1, "a": 2}) == '{"a":2,"b":1}'
    assert sha256_hex("x") == sha256_hex(b"x")


def test_sort_order_is_kind_then_date_then_theme_then_id():
    late = build_event(event_id="science:test:late", start_date=TODAY + timedelta(days=2))
    early = build_event(event_id="politics:test:early", theme=Theme.POLITICS, start_date=TODAY + timedelta(days=1))
    historical = build_event(
        event_id="science:test:historical",
        kind=EventKind.HISTORICAL,
        start_date=date(2000, 1, 1),
    )
    ordered = sort_events([late, early, historical])
    assert [event.event_id for event in ordered] == [
        "science:test:historical",
        "politics:test:early",
        "science:test:late",
    ]
    assert event_sort_key(ordered[0])[0] == "historical"


def test_bundle_version_stable_across_timestamps():
    event = build_event()
    same_content = build_event(collected=NOW + timedelta(hours=1), last=NOW + timedelta(hours=1))
    assert bundle_version_for([event]) == bundle_version_for([same_content])
    moved = build_event(start_date=event.start_date + timedelta(days=1))
    assert bundle_version_for([event]) != bundle_version_for([moved])


def test_event_status_values():
    assert [status.value for status in EventStatus] == [
        "scheduled",
        "tentative",
        "rescheduled",
        "cancelled",
        "completed",
        "unverified",
    ]
