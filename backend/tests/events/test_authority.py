from __future__ import annotations

from dataclasses import replace
from datetime import date, datetime, timedelta, timezone
from urllib.parse import urlparse

import pytest

from astro_finance.events.authority import (
    CENTRAL_BANK_CALENDARS,
    NASA_ECLIPSES,
    USNO_SEASONS,
    apply_authority,
    authority_for,
)
from astro_finance.events.lifecycle import merge_with_previous
from astro_finance.events.models import EventStatus, RawRecord, Theme
from astro_finance.events.registry import default_data_dir, load_registry
from astro_finance.events.sources import astronomy, culture, curated
from astro_finance.events.validation import NormalizationError, normalize_raw
from conftest import NOW, TODAY, build_event, build_source

FED = "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm"
BOE = "https://www.bankofengland.co.uk/monetary-policy/upcoming-mpc-dates"
ECB = "https://www.ecb.europa.eu/press/calendars/mgcgc/html/index.en.html"
USNO_2027 = (
    "https://aa.usno.navy.mil/calculated/seasons?year=2027"
    "&tz=0.00&tz_sign=-1&tz_label=false&dst=false&submit=Get+Data"
)

# Greatest eclipse (NASA, converted to UT on the page) and the USNO season
# times, read on 2026-11-06.  The computed instants must agree within a minute;
# NASA and USNO round to the second and the minute.
NASA_GREATEST_UT = {
    date(2027, 2, 6): datetime(2027, 2, 6, 15, 59, 35, tzinfo=timezone.utc),
    date(2027, 2, 20): datetime(2027, 2, 20, 23, 12, 50, tzinfo=timezone.utc),
    date(2027, 7, 18): datetime(2027, 7, 18, 16, 2, 53, tzinfo=timezone.utc),
    date(2027, 8, 2): datetime(2027, 8, 2, 10, 6, 37, tzinfo=timezone.utc),
    date(2027, 8, 17): datetime(2027, 8, 17, 7, 13, 43, tzinfo=timezone.utc),
}
USNO_UT = {
    date(2026, 12, 21): datetime(2026, 12, 21, 20, 50, tzinfo=timezone.utc),
    date(2027, 3, 20): datetime(2027, 3, 20, 20, 25, tzinfo=timezone.utc),
    date(2027, 6, 21): datetime(2027, 6, 21, 14, 11, tzinfo=timezone.utc),
    date(2027, 9, 23): datetime(2027, 9, 23, 6, 2, tzinfo=timezone.utc),
}


def _record(**changes) -> RawRecord:
    base = RawRecord(
        source_id="astronomy_computed",
        name="Total solar eclipse",
        theme=Theme.SCIENCE.value,
        start_date="2027-08-02",
        external_id="solar-eclipse-total-2027-08-02",
        start_time="10:06:37",
        timezone="UTC",
        all_day=False,
        verification="computed",
    )
    return replace(base, **changes)


def _season_key(record: RawRecord) -> tuple[str, str, int]:
    kind, month, year = (record.external_id or "").split("-")
    return kind, month, int(year)


def _start(record: RawRecord) -> datetime:
    return datetime.fromisoformat(f"{record.start_date}T{record.start_time}").replace(
        tzinfo=timezone.utc
    )


def test_every_table_url_is_https_on_its_official_host():
    hosts = {urlparse(url).netloc for url in NASA_ECLIPSES.values()}
    assert hosts == {"eclipse.gsfc.nasa.gov"}
    assert {urlparse(url).netloc for _, url, _ in CENTRAL_BANK_CALENDARS} == {
        "www.federalreserve.gov",
        "www.bankofengland.co.uk",
        "www.ecb.europa.eu",
    }
    for url in [*NASA_ECLIPSES.values(), *(url for _, url, _ in CENTRAL_BANK_CALENDARS)]:
        assert urlparse(url).scheme == "https"
    # NASA's 2021-2030 decade tables list two solar and three lunar eclipses in 2027.
    assert sorted(kind for kind, _, day in NASA_ECLIPSES if day.year == 2027) == [
        "lunar",
        "lunar",
        "lunar",
        "solar",
        "solar",
    ]


def test_an_eclipse_gets_its_nasa_page():
    assert authority_for(_record()) == NASA_ECLIPSES[("solar", "total", date(2027, 8, 2))]


@pytest.mark.parametrize(
    "changes",
    [
        {"start_date": "2027-08-03"},
        {"external_id": "solar-eclipse-annular-2027-08-02"},
        {"external_id": "lunar-eclipse-total-2027-08-02"},
        {"start_date": "2028-01-26", "external_id": "solar-eclipse-annular-2028-01-26"},
        {"source_id": "historical_curated"},
        {"theme": Theme.FINANCE.value},
        {"start_date": "not-a-date"},
    ],
)
def test_an_eclipse_that_does_not_match_gets_nothing(changes):
    assert authority_for(_record(**changes)) is None


def test_seasons_get_the_usno_table_for_their_year_only_on_its_date():
    record = _record(
        name="March equinox",
        external_id="equinox-march-2027",
        start_date="2027-03-20",
        start_time="20:24:41",
    )
    assert authority_for(record) == USNO_2027
    assert authority_for(replace(record, start_date="2027-03-21")) is None
    december_2026 = replace(
        record,
        name="December solstice",
        external_id="solstice-december-2026",
        start_date="2026-12-21",
    )
    assert "year=2026&" in (authority_for(december_2026) or "")
    later = replace(record, external_id="equinox-march-2028", start_date="2028-03-20")
    assert authority_for(later) is None


@pytest.mark.parametrize(
    ("external_id", "day", "expected"),
    [
        ("fomc-2027-01", "2027-01-27", FED),
        ("fomc-2027-12", "2027-12-08", FED),
        ("fomc-2027-01", "2027-01-26", None),  # the first meeting day, not the decision
        ("boe-mpc-2027-02", "2027-02-04", BOE),
        ("boe-mpc-2027-02", "2027-02-05", None),
        ("ecb-gc-2027-06", "2027-06-10", ECB),
        ("ecb-gc-2027-06", "2027-06-17", None),
        ("rba-2027-02", "2027-02-04", None),
    ],
)
def test_central_bank_decisions_need_a_listed_date(external_id, day, expected):
    record = RawRecord(
        source_id="curated_upcoming",
        name="A decision",
        theme=Theme.FINANCE.value,
        start_date=day,
        external_id=external_id,
    )
    assert authority_for(record) == expected


def test_fred_releases_and_computed_festivals_get_nothing():
    fred_record = RawRecord(
        source_id="fred_release_dates",
        name="Consumer Price Index",
        theme=Theme.FINANCE.value,
        start_date="2027-01-13",
        external_id="10-2027-01-13",
    )
    assert authority_for(fred_record) is None
    fomc_press = replace(
        fred_record,
        name="FOMC Press Release",
        external_id="101-2027-01-27",
        start_date="2027-01-27",
    )
    assert authority_for(fomc_press) is None
    source = build_source(
        source_id="culture_computed",
        themes=(Theme.CULTURE_RELIGION,),
        url="https://www.churchofengland.org/",
    )
    for record in culture.extract(source, today=TODAY, now=NOW).records:
        assert apply_authority(record).authority_url is None


def test_apply_never_overrides_a_source_authority():
    own = _record(authority_url="https://example.org/own-page")
    assert apply_authority(own) is own
    assert apply_authority(_record()).authority_url == NASA_ECLIPSES[
        ("solar", "total", date(2027, 8, 2))
    ]


def test_every_computed_sky_event_in_the_window_gets_an_authority_that_matches():
    source = build_source(
        source_id="astronomy_computed",
        themes=(Theme.SCIENCE,),
        url="https://www.astro.com/swisseph/",
    )
    records = [
        apply_authority(record)
        for record in astronomy.extract(source, today=TODAY, now=NOW).records
    ]
    assert records
    for record in records:
        day = date.fromisoformat(record.start_date)
        assert record.authority_url, record.external_id
        if "eclipse" in (record.external_id or ""):
            assert record.authority_url.startswith("https://eclipse.gsfc.nasa.gov/")
            assert abs(_start(record) - NASA_GREATEST_UT[day]) <= timedelta(seconds=60)
        else:
            assert record.authority_url.startswith("https://aa.usno.navy.mil/")
            assert f"year={day.year}&" in record.authority_url
            assert abs(_start(record) - USNO_UT[day]) <= timedelta(seconds=60)
            assert USNO_SEASONS[_season_key(record)] == day


def test_every_curated_decision_is_on_its_banks_calendar():
    registry = load_registry().by_id()
    source = registry["curated_upcoming"]
    records = curated.extract(
        source, today=TODAY, now=NOW, data_dir=default_data_dir()
    ).records
    finance = [record for record in records if record.theme == Theme.FINANCE.value]
    assert finance
    for record in finance:
        authority = apply_authority(record).authority_url
        assert authority == record.source_url, record.external_id


def test_normalisation_carries_and_checks_the_authority():
    source = build_source(source_id="astronomy_computed", themes=(Theme.SCIENCE,))
    event = normalize_raw(apply_authority(_record()), source, today=TODAY, now=NOW)
    assert event.authority_url == NASA_ECLIPSES[("solar", "total", date(2027, 8, 2))]
    assert event.content_dict()["authority_url"] == event.authority_url
    with pytest.raises(NormalizationError) as error:
        normalize_raw(
            _record(authority_url="http://eclipse.gsfc.nasa.gov/insecure"),
            source,
            today=TODAY,
            now=NOW,
        )
    assert any("authority_url" in reason for reason in error.value.reasons)


def test_an_event_without_authority_keeps_its_old_hash():
    event = build_event()
    assert "authority_url" not in event.content_dict()
    assert "authority_url" not in event.to_dict()
    with_page = build_event(authority_url="https://example.org/page")
    assert with_page.content_hash != event.content_hash
    assert with_page.to_dict()["authority_url"] == "https://example.org/page"


def test_lifecycle_adopts_a_new_authority_and_drops_it_when_the_date_moves():
    day = TODAY + timedelta(days=40)
    previous = build_event(event_id="finance:test:fomc", theme=Theme.FINANCE, start_date=day)
    incoming = build_event(
        event_id="finance:test:fomc",
        theme=Theme.FINANCE,
        start_date=day,
        authority_url=FED,
    )
    later = NOW + timedelta(days=7)
    same = merge_with_previous(
        [incoming],
        [previous],
        today=TODAY,
        now=later,
        successful_source_ids={"test_source"},
        historical_source_changed=False,
    ).events
    assert [event.authority_url for event in same] == [FED]

    moved = build_event(
        event_id="finance:test:fomc",
        theme=Theme.FINANCE,
        start_date=day + timedelta(days=1),
    )
    result = merge_with_previous(
        [moved],
        same,
        today=TODAY,
        now=later + timedelta(days=7),
        successful_source_ids={"test_source"},
        historical_source_changed=False,
    ).events
    by_id = {event.event_id: event for event in result}
    archived = next(event for event in result if "@" in event.event_id)
    assert archived.status is EventStatus.RESCHEDULED
    assert archived.authority_url is None
    assert by_id["finance:test:fomc"].authority_url is None
