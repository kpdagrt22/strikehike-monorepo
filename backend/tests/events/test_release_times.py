from __future__ import annotations

from datetime import date, time, timezone

from astro_finance.events.models import RawRecord, start_instant
from astro_finance.events.release_times import apply_release_time, release_time_for


def _raw(**overrides) -> RawRecord:
    payload = {
        "source_id": "fred_release_dates",
        "name": "Employment Situation (November 2026)",
        "theme": "Finance",
        "start_date": "2026-11-06",
        "external_id": "50-2026-11",
        "start_time": None,
        "timezone": None,
        "all_day": True,
    }
    payload.update(overrides)
    return RawRecord(**payload)


def test_fred_series_get_their_official_times():
    expected = {
        "50-2026-11": time(8, 30),
        "10-2026-11": time(8, 30),
        "53-2026-11": time(8, 30),
        "54-2026-11": time(8, 30),
    }
    for external_id, start_time in expected.items():
        record = _raw(external_id=external_id)
        mapped = apply_release_time(record)
        assert mapped.all_day is False
        assert mapped.start_time == start_time.isoformat(timespec="seconds")
        assert mapped.timezone == "America/New_York"


def test_curated_decisions_get_their_official_times():
    expected = {
        "fomc-2026-12": (time(14, 0), "America/New_York"),
        "boe-mpc-2026-11": (time(12, 0), "Europe/London"),
        "ecb-gc-2026-12": (time(14, 15), "Europe/Berlin"),
    }
    for external_id, (start_time, zone) in expected.items():
        record = _raw(
            source_id="curated_upcoming",
            external_id=external_id,
            name="A central-bank decision",
            start_date="2026-12-17",
        )
        mapped = apply_release_time(record)
        assert mapped.all_day is False
        assert mapped.start_time == start_time.isoformat(timespec="seconds")
        assert mapped.timezone == zone


def test_unconfirmed_series_stay_all_day():
    for record in (
        _raw(external_id="999-2026-11"),
        _raw(source_id="curated_upcoming", external_id="other-2026-12"),
        _raw(theme="Science", external_id="50-2026-11"),
    ):
        assert release_time_for(record) is None
        assert apply_release_time(record) == record


def test_explicit_source_time_is_never_overridden():
    record = _raw(
        source_id="curated_upcoming",
        external_id="fomc-2026-12",
        start_time="09:00:00",
        timezone="UTC",
        all_day=False,
    )
    assert apply_release_time(record) == record


def test_eastern_0830_is_dst_correct_on_both_sides_of_both_changes():
    # US daylight time starts on 14 March 2027 and ends on 7 November 2027.
    cases = {
        date(2027, 3, 5): "2027-03-05T13:30:00Z",   # EST, UTC-5
        date(2027, 3, 15): "2027-03-15T12:30:00Z",  # EDT, UTC-4
        date(2027, 11, 1): "2027-11-01T12:30:00Z",  # EDT, UTC-4
        date(2027, 11, 8): "2027-11-08T13:30:00Z",  # EST, UTC-5
    }
    for day, expected in cases.items():
        instant = start_instant(day, time(8, 30), "America/New_York")
        assert instant is not None
        assert instant.astimezone(timezone.utc).isoformat().replace("+00:00", "Z") == expected


def test_all_day_events_have_no_instant():
    assert start_instant(date(2027, 3, 5), None, "America/New_York") is None
    assert start_instant(date(2027, 3, 5), time(8, 30), None) is None
