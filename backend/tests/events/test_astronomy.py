from __future__ import annotations

from datetime import date, timedelta

from astro_finance.events.models import Theme
from astro_finance.events.sources.astronomy import (
    extract as extract_astronomy,
)
from astro_finance.events.sources.astronomy import (
    lunar_eclipses,
    seasonal_events,
    solar_eclipses,
)
from astro_finance.events.sources.culture import orthodox_easter, western_easter
from conftest import NOW, TODAY, build_source


def test_total_solar_eclipse_of_2027_08_02_matches_nasa():
    events = solar_eclipses(TODAY, TODAY + timedelta(days=365))
    eclipse = next(
        moment
        for kind, moment in events
        if kind == "total" and moment.date() == date(2027, 8, 2)
    )
    assert eclipse.hour == 10
    assert 0 <= eclipse.minute <= 15


def test_annular_solar_eclipse_of_2027_02_06_is_found():
    events = solar_eclipses(TODAY, TODAY + timedelta(days=365))
    assert any(
        kind == "annular" and moment.date() == date(2027, 2, 6)
        for kind, moment in events
    )


def test_penumbral_lunar_eclipse_of_2027_02_20_is_found():
    events = lunar_eclipses(TODAY, TODAY + timedelta(days=365))
    assert any(
        kind == "penumbral" and moment.date() == date(2027, 2, 20)
        for kind, moment in events
    )


def test_seasonal_events_are_the_expected_four():
    events = seasonal_events(TODAY, TODAY + timedelta(days=365))
    assert [(name, moment.date()) for name, _, moment in events] == [
        ("December solstice", date(2026, 12, 21)),
        ("March equinox", date(2027, 3, 20)),
        ("June solstice", date(2027, 6, 21)),
        ("September equinox", date(2027, 9, 23)),
    ]


def test_no_astronomy_event_is_outside_the_window():
    end = TODAY + timedelta(days=365)
    for _, moment in [*solar_eclipses(TODAY, end), *lunar_eclipses(TODAY, end)]:
        assert TODAY <= moment.date() <= end
    for _, _, moment in seasonal_events(TODAY, end):
        assert TODAY <= moment.date() <= end


def test_western_easter_matches_published_dates():
    assert western_easter(2024) == date(2024, 3, 31)
    assert western_easter(2025) == date(2025, 4, 20)
    assert western_easter(2026) == date(2026, 4, 5)
    assert western_easter(2027) == date(2027, 3, 28)


def test_orthodox_easter_matches_published_dates():
    assert orthodox_easter(2024) == date(2024, 5, 5)
    assert orthodox_easter(2025) == date(2025, 4, 20)
    assert orthodox_easter(2026) == date(2026, 4, 12)
    assert orthodox_easter(2027) == date(2027, 5, 2)


def test_astronomy_extract_returns_utc_raw_records():
    source = build_source(
        source_id="astronomy_computed",
        themes=(Theme.SCIENCE,),
        url="https://example.com/swisseph",
    )
    extraction = extract_astronomy(source, today=TODAY, now=NOW)
    assert extraction.records
    for record in extraction.records:
        assert record.timezone == "UTC"
        assert record.all_day is False
        assert record.start_time
        assert record.verification == "computed"
    assert "computed_events.json" in extraction.raw_payloads
