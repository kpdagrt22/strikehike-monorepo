from __future__ import annotations

from dataclasses import replace
from datetime import date, time, timedelta

import pytest

from astro_finance.events.models import (
    EventKind,
    EventStatus,
    RawRecord,
    Theme,
    Verification,
    replace_event,
)
from astro_finance.events.text import normalize_text, parse_time, slugify
from astro_finance.events.validation import (
    NormalizationError,
    event_id_for,
    normalize_raw,
    validate_event,
)
from conftest import NOW, TODAY, build_event, build_source


def _raw(**overrides) -> RawRecord:
    payload = {
        "source_id": "test_source",
        "name": "Test event",
        "theme": "Science",
        "start_date": "2026-12-01",
        "description": "Description",
        "external_id": None,
        "start_time": None,
        "timezone": None,
        "all_day": True,
        "status": "scheduled",
        "source_url": "https://example.com/event",
        "verification": "verified",
        "kind": "upcoming",
    }
    payload.update(overrides)
    return RawRecord(**payload)


def test_normalize_text_is_nfc_and_collapses_whitespace():
    assert normalize_text("  Cafe\u0301   au\tlait  ") == "Café au lait"
    assert normalize_text("a\n\nb") == "a b"


def test_slugify_transliterates_and_has_a_fallback():
    assert slugify("Café au lait") == "cafe-au-lait"
    assert slugify("東京") == "event-8b7a0b0d" or slugify("東京").startswith("event-")
    assert slugify("  --  ") == "event"


def test_parse_time_accepts_minutes_and_seconds():
    assert parse_time("09:30") == time(9, 30)
    assert parse_time("09:30:15") == time(9, 30, 15)
    with pytest.raises(ValueError):
        parse_time("9:30")


def test_event_id_uses_external_id_when_present():
    source = build_source()
    event_id = event_id_for(
        source, Theme.SCIENCE, "Name", date(2027, 1, 1), "ext 42/α"
    )
    assert event_id == "science:test_source:ext-42"


def test_event_id_fallback_keeps_identity_across_a_reschedule():
    source = build_source()
    first = event_id_for(source, Theme.SCIENCE, "Café event", date(2027, 3, 1), None)
    second = event_id_for(source, Theme.SCIENCE, "Café event", date(2027, 3, 8), None)
    assert first == second == "science:test_source:cafe-event:2027"


def test_event_id_changes_across_years():
    source = build_source()
    assert event_id_for(source, Theme.SCIENCE, "Event", date(2026, 12, 31), None) != event_id_for(
        source, Theme.SCIENCE, "Event", date(2027, 1, 1), None
    )


def test_normalize_raw_produces_a_canonical_event():
    event = normalize_raw(_raw(), build_source(), today=TODAY, now=NOW)
    assert event.kind is EventKind.UPCOMING
    assert event.theme is Theme.SCIENCE
    assert event.verification is Verification.VERIFIED
    assert event.status is EventStatus.SCHEDULED
    assert event.all_day is True
    assert event.event_id.startswith("science:test_source:test-event:2026")
    assert event.days_until is None


def test_normalize_raw_accepts_a_timed_event():
    event = normalize_raw(
        _raw(
            all_day=False,
            start_time="09:30",
            timezone="Asia/Kolkata",
            start_date="2026-12-02",
        ),
        build_source(),
        today=TODAY,
        now=NOW,
    )
    assert event.all_day is False
    assert event.start_time == time(9, 30)
    assert event.timezone == "Asia/Kolkata"


@pytest.mark.parametrize(
    "overrides",
    [
        {"all_day": True, "start_time": "09:30"},
        {"all_day": False, "start_time": None, "timezone": "UTC"},
        {"all_day": False, "start_time": "09:30", "timezone": None},
        {"timezone": "Mars/Olympus"},
        {"source_url": "http://example.com/event"},
        {"theme": "Astrology"},
        {"status": "pending"},
        {"kind": "future"},
        {"verification": "maybe"},
        {"start_date": "01/12/2026"},
    ],
)
def test_normalize_raw_rejects_bad_shapes(overrides):
    with pytest.raises(NormalizationError):
        normalize_raw(_raw(**overrides), build_source(), today=TODAY, now=NOW)


def test_normalize_raw_rejects_theme_not_declared_by_source():
    source = build_source(themes=(Theme.FINANCE,))
    with pytest.raises(NormalizationError, match="not declared"):
        normalize_raw(_raw(), source, today=TODAY, now=NOW)


def test_normalize_raw_rejects_a_non_boolean_all_day():
    with pytest.raises(NormalizationError, match="boolean"):
        normalize_raw(_raw(all_day="yes"), build_source(), today=TODAY, now=NOW)


def test_validate_event_accepts_a_good_event():
    event = normalize_raw(_raw(), build_source(), today=TODAY, now=NOW)
    assert validate_event(event, today=TODAY, source=build_source()) == []


def test_validate_event_rejects_an_upcoming_event_before_today():
    event = build_event(start_date=TODAY - timedelta(days=1))
    reasons = validate_event(event, today=TODAY)
    assert any("before today" in reason for reason in reasons)


def test_validate_event_rejects_an_upcoming_event_beyond_400_days():
    event = build_event(start_date=TODAY + timedelta(days=401))
    reasons = validate_event(event, today=TODAY)
    assert any("beyond" in reason for reason in reasons)


def test_validate_event_rejects_a_future_historical_event():
    event = build_event(
        kind=EventKind.HISTORICAL,
        start_date=TODAY + timedelta(days=1),
        status=EventStatus.COMPLETED,
    )
    reasons = validate_event(event, today=TODAY)
    assert any("future" in reason for reason in reasons)


def test_validate_event_rejects_a_historical_event_not_completed():
    event = replace_event(
        build_event(kind=EventKind.HISTORICAL), status=EventStatus.SCHEDULED
    )
    reasons = validate_event(event, today=TODAY)
    assert any("completed" in reason for reason in reasons)


def test_validate_event_rejects_http_source_url():
    event = build_event(source_url="http://example.com/event")
    assert any("https" in reason for reason in validate_event(event, today=TODAY))


def test_validate_event_rejects_a_wrong_content_hash():
    event = build_event()
    tampered = replace(event, content_hash="0" * 64)
    assert any("content_hash" in reason for reason in validate_event(tampered, today=TODAY))


def test_validate_event_rejects_time_without_all_day_false():
    event = build_event(all_day=True, start_time=time(9, 0), timezone_name="UTC")
    reasons = validate_event(event, today=TODAY)
    assert any("all_day" in reason for reason in reasons)
