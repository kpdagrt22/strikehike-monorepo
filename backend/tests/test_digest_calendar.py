from __future__ import annotations

from datetime import date

from astro_finance.digest.calendar_links import (
    calendar_actions,
    google_calendar_url,
    ics_url,
    ist_date,
    item_key,
    outlook_calendar_url,
)

BASE = "https://strikehike.com"
WEEK = "2026-W47"

CPI = {
    "id": "finance:test:cpi",
    "name": "CPI & GDP",
    "start_date": "2026-11-18",
    "start_time": "13:30:00",
    "timezone": "America/New_York",
    "start_utc": "2026-11-18T13:30:00Z",
    "path": "/events/finance~test~cpi",
}
SKY = {
    "kind": "new_moon",
    "body": "Moon",
    "at": "2026-11-17T11:47:47Z",
    "path": "/upcoming/science",
    "label": "New moon",
}
ALL_DAY = {
    "id": "culture:test:holiday",
    "name": "Holiday",
    "start_date": "2026-11-19",
    "start_time": None,
    "path": "/events/culture~test~holiday",
}
FOMC = {
    "id": "finance:fomc:2026-12",
    "name": "FOMC meeting",
    "start_date": "2026-12-09",
    "start_time": "14:00:00",
    "timezone": "America/New_York",
    "start_utc": "2026-12-09T19:00:00Z",
    "path": "/events/finance~fomc~2026-12",
}


def test_google_url_encodes_text_and_uses_utc_dates():
    url = google_calendar_url(CPI, BASE)
    assert "dates=20261118T133000Z%2F20261118T140000Z" in url
    assert "text=CPI%20%26%20GDP%20%C2%B7%20StrikeHike" in url
    assert "location=https%3A%2F%2Fstrikehike.com%2Fevents%2Ffinance~test~cpi" in url
    assert "details=CPI%20%26%20GDP" in url


def test_google_all_day_uses_a_one_day_span():
    url = google_calendar_url(ALL_DAY, BASE)
    assert "dates=20261119%2F20261120" in url


def test_outlook_url_uses_iso_utc_and_allday_flag():
    timed = outlook_calendar_url(CPI, BASE)
    assert "startdt=2026-11-18T13%3A30%3A00Z" in timed
    assert "enddt=2026-11-18T14%3A00%3A00Z" in timed
    assert "allday=false" in timed
    whole = outlook_calendar_url(ALL_DAY, BASE)
    assert "startdt=2026-11-19T00%3A00%3A00Z" in whole
    assert "allday=true" in whole


def test_ics_url_uses_the_event_bundle_or_the_week_item_route():
    assert ics_url(CPI, WEEK, BASE) == (
        "https://strikehike.com/calendar/event/finance~test~cpi.ics"
    )
    sky_url = ics_url(SKY, WEEK, BASE)
    assert sky_url.startswith(
        "https://strikehike.com/this-week/2026-W47/calendar/new-moon"
    )
    assert sky_url.endswith(".ics")


def test_the_ist_date_can_differ_without_moving_the_utc_instant():
    assert ist_date(FOMC) == date(2026, 12, 10)
    url = google_calendar_url(FOMC, BASE)
    assert "dates=20261209T190000Z%2F20261209T193000Z" in url


def test_item_key_is_stable_and_short():
    assert item_key(SKY).startswith("new-moon-moon-")
    assert item_key(CPI) == "finance-test-cpi"
    actions = calendar_actions(CPI, WEEK, BASE)
    assert actions["key"] == "finance-test-cpi"
    assert actions["ics"].endswith("/calendar/event/finance~test~cpi.ics")
