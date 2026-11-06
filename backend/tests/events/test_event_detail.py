from __future__ import annotations

import json
import re
import sqlite3
from datetime import date, time, timedelta
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from astro_finance.events.bundle import write_dataset
from astro_finance.events.models import (
    EVENT_ID_PATTERN,
    EventKind,
    EventStatus,
    Theme,
    Verification,
)
from astro_finance.events.router import get_today, router
from conftest import TODAY, build_event
from test_calendar import unescape, unfold, vevents

NASA_URL = "https://eclipse.gsfc.nasa.gov/SEpath/SEpath2001/SE2027Aug02Tpath.html"
ANALYTICS_SCHEMA = (
    Path(__file__).resolve().parents[2]
    / "src"
    / "astro_finance"
    / "analytics"
    / "schema.json"
)


def _make_runtime(tmp_path: Path, events) -> Path:
    runtime = tmp_path / "runtime"
    bundle = runtime / "bundles" / "2026-11-03-test"
    write_dataset(bundle, events, today=TODAY)
    (bundle / "manifest.json").write_text(
        json.dumps(
            {
                "bundle_version": "testbundle000001",
                "schema_version": 1,
                "created_at": "2026-11-03T12:00:00Z",
                "as_of": TODAY.isoformat(),
                "counts": {},
                "publishable": True,
                "files": {},
            }
        ),
        encoding="utf-8",
    )
    runtime.mkdir(parents=True, exist_ok=True)
    (runtime / "current").write_text("bundles/2026-11-03-test\n", encoding="utf-8")
    return runtime


def _events():
    return [
        build_event(
            event_id="science:astronomy_computed:solar-eclipse-total-2027-08-02",
            name="Total solar eclipse",
            theme=Theme.SCIENCE,
            start_date=date(2027, 8, 2),
            all_day=False,
            start_time=time(10, 6, 37),
            timezone_name="UTC",
            description="The Moon fully covers the Sun along a narrow path.",
            source_id="astronomy_computed",
            source_url="https://www.astro.com/swisseph/",
            verification=Verification.COMPUTED,
            authority_url=NASA_URL,
        ),
        build_event(
            event_id="finance:test:decision",
            name="A central-bank decision; with, commas",
            theme=Theme.FINANCE,
            start_date=TODAY + timedelta(days=130),
            all_day=False,
            start_time=time(14, 15),
            timezone_name="Europe/Berlin",
        ),
        build_event(
            event_id="culture-religion:test:festival",
            name="A festival",
            theme=Theme.CULTURE_RELIGION,
            start_date=TODAY + timedelta(days=140),
        ),
        build_event(
            event_id="science:test:cancelled",
            name="A cancelled date",
            start_date=TODAY + timedelta(days=121),
            status=EventStatus.CANCELLED,
        ),
        build_event(
            event_id="finance:historical_curated:black-tuesday:1929",
            name="Black Tuesday",
            theme=Theme.FINANCE,
            kind=EventKind.HISTORICAL,
            start_date=date(1929, 10, 29),
            description="The worst day of the 1929 crash.",
            source_id="historical_curated",
        ),
    ]


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("EVENTS_RUNTIME_DIR", str(_make_runtime(tmp_path, _events())))
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_today] = lambda: TODAY
    return TestClient(app)


def test_one_upcoming_event_has_description_start_utc_and_authority(client):
    response = client.get(
        "/api/v1/events/science:astronomy_computed:solar-eclipse-total-2027-08-02"
    )
    assert response.status_code == 200
    assert response.headers["cache-control"] == (
        "public, s-maxage=3600, stale-while-revalidate=86400"
    )
    payload = response.json()
    assert payload["event_id"] == (
        "science:astronomy_computed:solar-eclipse-total-2027-08-02"
    )
    assert payload["kind"] == "upcoming"
    assert payload["theme"] == "Science"
    assert payload["status"] == "scheduled"
    assert payload["description"] == "The Moon fully covers the Sun along a narrow path."
    assert payload["start_utc"] == "2027-08-02T10:06:37Z"
    assert payload["all_day"] is False
    assert payload["source_id"] == "astronomy_computed"
    assert payload["source_url"] == "https://www.astro.com/swisseph/"
    assert payload["authority_url"] == NASA_URL
    assert payload["days_until"] == (date(2027, 8, 2) - TODAY).days


def test_an_event_without_authority_says_null(client):
    payload = client.get("/api/v1/events/finance:test:decision").json()
    assert payload["authority_url"] is None
    assert payload["start_utc"] == "2027-03-13T13:15:00Z"


def test_a_historical_event_is_served_with_negative_days(client):
    response = client.get("/api/v1/events/finance:historical_curated:black-tuesday:1929")
    assert response.status_code == 200
    payload = response.json()
    assert payload["kind"] == "historical"
    assert payload["status"] == "completed"
    assert payload["all_day"] is True
    assert payload["start_utc"] is None
    assert payload["days_until"] < 0
    assert payload["authority_url"] is None


def test_unknown_id_is_404(client):
    response = client.get("/api/v1/events/science:test:does-not-exist")
    assert response.status_code == 404
    assert client.get("/api/v1/events/science:test:does-not-exist.ics").status_code == 404


@pytest.mark.parametrize(
    "event_id",
    [
        "not-an-id",
        "Science:test:capital-theme",
        "science:test",
        "science:Test:capital-source",
        "science:test:space%20inside",
        "science:test:archived@2027-01-01",
        "science:test:archived@2027-01-01~2",
        "science:test:" + "x" * 160,
    ],
)
def test_bad_grammar_is_422_before_any_lookup(tmp_path, monkeypatch, event_id):
    # No bundle at all: a lookup would be 503, so 422 proves the check runs first.
    monkeypatch.setenv("EVENTS_RUNTIME_DIR", str(tmp_path / "missing"))
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_today] = lambda: TODAY
    client = TestClient(app)
    assert client.get(f"/api/v1/events/{event_id}").status_code == 422
    assert client.get(f"/api/v1/events/{event_id}.ics").status_code == 422


def test_static_event_routes_keep_their_handlers(client):
    assert client.get("/api/v1/events/upcoming").status_code == 200
    assert client.get("/api/v1/events/health").status_code == 200
    assert client.get("/api/v1/events/calendar.ics").status_code == 200


def test_no_bundle_is_503_for_a_valid_id(tmp_path, monkeypatch):
    monkeypatch.setenv("EVENTS_RUNTIME_DIR", str(tmp_path / "missing"))
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_today] = lambda: TODAY
    client = TestClient(app)
    assert client.get("/api/v1/events/science:test:x").status_code == 503
    assert client.get("/api/v1/events/science:test:x.ics").status_code == 503


def test_the_grammar_is_the_analytics_one():
    schema = json.loads(ANALYTICS_SCHEMA.read_text(encoding="utf-8"))
    pattern = schema["events"]["event_source_clicked"]["properties"]["event_id"]["pattern"]
    assert pattern == EVENT_ID_PATTERN
    assert re.fullmatch(EVENT_ID_PATTERN, "finance:curated_upcoming:fomc-2027-01")


def test_upcoming_lists_carry_description_source_and_authority(client):
    payload = client.get("/api/v1/events/upcoming?limit_per_theme=100").json()
    science = {event["event_id"]: event for event in payload["themes"]["Science"]["events"]}
    eclipse = science["science:astronomy_computed:solar-eclipse-total-2027-08-02"]
    assert eclipse["authority_url"] == NASA_URL
    assert eclipse["source_id"] == "astronomy_computed"
    assert eclipse["description"].startswith("The Moon")
    finance = payload["themes"]["Finance"]["events"][0]
    assert finance["authority_url"] is None


def test_a_bundle_without_the_authority_column_still_reads(tmp_path, monkeypatch):
    runtime = _make_runtime(tmp_path, _events())
    db_path = runtime / "bundles" / "2026-11-03-test" / "events.sqlite"
    connection = sqlite3.connect(db_path)
    try:
        connection.execute("ALTER TABLE events DROP COLUMN authority_url")
        connection.commit()
        columns = [row[1] for row in connection.execute("PRAGMA table_info(events)")]
    finally:
        connection.close()
    assert "authority_url" not in columns

    monkeypatch.setenv("EVENTS_RUNTIME_DIR", str(runtime))
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_today] = lambda: TODAY
    client = TestClient(app)
    detail = client.get(
        "/api/v1/events/science:astronomy_computed:solar-eclipse-total-2027-08-02"
    )
    assert detail.status_code == 200
    assert detail.json()["authority_url"] is None
    upcoming = client.get("/api/v1/events/upcoming").json()
    assert all(
        event["authority_url"] is None
        for theme in upcoming["themes"].values()
        for event in theme["events"]
    )
    assert client.get("/api/v1/events/calendar.ics").status_code == 200


def test_single_event_calendar_is_rfc5545_shaped(client):
    response = client.get("/api/v1/events/finance:test:decision.ics")
    assert response.status_code == 200
    assert response.headers["content-type"] == "text/calendar; charset=utf-8"
    assert response.headers["cache-control"] == "public, max-age=3600"
    assert response.headers["content-disposition"] == 'attachment; filename="decision.ics"'
    assert response.headers["etag"].startswith('"testbundle000001-')

    physical, lines = unfold(response.content)
    assert lines[0] == "BEGIN:VCALENDAR"
    assert lines[-1] == "END:VCALENDAR"
    assert "VERSION:2.0" in lines
    assert "PRODID:-//StrikeHike//Upcoming dates//EN" in lines
    assert "CALSCALE:GREGORIAN" in lines
    assert "METHOD:PUBLISH" in lines
    # A one-off import, not a subscription: no calendar name, no refresh.
    assert not any(line.startswith("X-WR-CALNAME") for line in lines)
    assert not any(line.startswith("REFRESH-INTERVAL") for line in lines)
    assert len(physical) >= len(lines)

    events = vevents(lines)
    assert len(events) == 1
    event = events[0]
    assert event["UID"] == "finance:test:decision@strikehike.com"
    assert event["DTSTAMP"] == "20261103T120000Z"
    assert event["LAST-MODIFIED"] == "20261103T120000Z"
    assert event["DTSTART"] == "20270313T131500Z"
    assert event["DTEND"] == "20270313T134500Z"
    assert "DTSTART_PARAMS" not in event
    assert unescape(event["SUMMARY"]) == "A central-bank decision; with, commas"
    assert event["SUMMARY"] == "A central-bank decision\\; with\\, commas"
    assert event["STATUS"] == "CONFIRMED"
    assert event["TRANSP"] == "TRANSPARENT"
    assert "Dates only" in unescape(event["DESCRIPTION"])


def test_single_event_calendar_uid_matches_the_feed(client):
    single = vevents(unfold(client.get("/api/v1/events/finance:test:decision.ics").content)[1])
    feed = vevents(unfold(client.get("/api/v1/events/calendar.ics?themes=Finance").content)[1])
    assert single[0] == next(event for event in feed if event["UID"] == single[0]["UID"])


def test_single_event_calendar_all_day_and_status(client):
    _, lines = unfold(client.get("/api/v1/events/culture-religion:test:festival.ics").content)
    event = vevents(lines)[0]
    assert event["DTSTART_PARAMS"] == "VALUE=DATE"
    assert event["DTEND_PARAMS"] == "VALUE=DATE"
    start = TODAY + timedelta(days=140)
    assert event["DTSTART"] == start.strftime("%Y%m%d")
    assert event["DTEND"] == (start + timedelta(days=1)).strftime("%Y%m%d")

    _, lines = unfold(client.get("/api/v1/events/science:test:cancelled.ics").content)
    assert vevents(lines)[0]["STATUS"] == "CANCELLED"


def test_single_event_calendar_folds_long_lines(client):
    response = client.get(
        "/api/v1/events/science:astronomy_computed:solar-eclipse-total-2027-08-02.ics"
    )
    physical, lines = unfold(response.content)
    assert any(line.startswith(" ") for line in physical)
    event = vevents(lines)[0]
    assert event["DTSTART"] == "20270802T100637Z"
    assert response.headers["content-disposition"] == (
        'attachment; filename="solar-eclipse-total-2027-08-02.ics"'
    )


def test_single_event_calendar_is_byte_identical_twice(client):
    first = client.get("/api/v1/events/finance:test:decision.ics")
    second = client.get("/api/v1/events/finance:test:decision.ics")
    assert first.content == second.content
    assert first.headers["etag"] == second.headers["etag"]
