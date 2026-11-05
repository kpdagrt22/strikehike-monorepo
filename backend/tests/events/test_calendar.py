from __future__ import annotations

import json
from datetime import time, timedelta
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from astro_finance.events.bundle import write_dataset
from astro_finance.events.calendar import build_calendar
from astro_finance.events.models import EventStatus, Theme
from astro_finance.events.router import get_today, router
from conftest import TODAY, build_event

LONG_NAME = (
    "December solstice — a deliberately long name with ünïcödé, commas, "
    "semicolons; and enough words to force folding across octets"
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
            event_id="science:test:solstice",
            name=LONG_NAME,
            theme=Theme.SCIENCE,
            start_date=TODAY + timedelta(days=132),
            all_day=False,
            start_time=time(8, 30),
            timezone_name="America/New_York",
        ),
        build_event(
            event_id="science:test:all-day",
            name="An all-day festival",
            theme=Theme.SCIENCE,
            start_date=TODAY + timedelta(days=120),
        ),
        build_event(
            event_id="science:test:cancelled",
            name="A cancelled date",
            theme=Theme.SCIENCE,
            start_date=TODAY + timedelta(days=121),
            status=EventStatus.CANCELLED,
        ),
        build_event(
            event_id="finance:test:decision",
            name="A central-bank decision",
            theme=Theme.FINANCE,
            start_date=TODAY + timedelta(days=130),
            all_day=False,
            start_time=time(14, 15),
            timezone_name="Europe/Berlin",
        ),
        build_event(
            event_id="culture:test:festival",
            name="A festival",
            theme=Theme.CULTURE_RELIGION,
            start_date=TODAY + timedelta(days=140),
        ),
    ]


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("EVENTS_RUNTIME_DIR", str(_make_runtime(tmp_path, _events())))
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_today] = lambda: TODAY
    return TestClient(app)


def unfold(body: bytes) -> tuple[list[str], list[str]]:
    text = body.decode("utf-8")
    assert text.endswith("\r\n")
    # CRLF only: every LF is preceded by CR, and no CR stands alone.
    assert text.count("\n") == text.count("\r\n")
    physical = text.split("\r\n")
    if physical and physical[-1] == "":
        physical.pop()
    unfolded: list[str] = []
    for line in physical:
        assert len(line.encode("utf-8")) <= 75
        if line.startswith(" "):
            unfolded[-1] += line[1:]
        else:
            unfolded.append(line)
    return physical, unfolded


def unescape(value: str) -> str:
    out: list[str] = []
    index = 0
    while index < len(value):
        if value[index] == "\\" and index + 1 < len(value):
            following = value[index + 1]
            out.append({"n": "\n", "\\": "\\", ";": ";", ",": ","}.get(following, following))
            index += 2
        else:
            out.append(value[index])
            index += 1
    return "".join(out)


def vevents(lines: list[str]) -> list[dict[str, str]]:
    events: list[dict[str, str]] = []
    current: dict[str, str] | None = None
    for line in lines:
        if line == "BEGIN:VEVENT":
            current = {}
        elif line == "END:VEVENT":
            assert current is not None
            events.append(current)
            current = None
        elif current is not None:
            key, _, value = line.partition(":")
            base, _, params = key.partition(";")
            current[base] = value
            if params:
                current[f"{base}_PARAMS"] = params
    return events


def test_finance_calendar_is_rfc5545_shaped_and_folded(client):
    response = client.get("/api/v1/events/calendar.ics?themes=Science,Finance")
    assert response.status_code == 200
    assert response.headers["content-type"] == "text/calendar; charset=utf-8"
    assert response.headers["cache-control"] == "public, max-age=3600"
    assert response.headers["etag"] == '"testbundle000001-science-finance"'

    physical, lines = unfold(response.content)
    assert lines[0] == "BEGIN:VCALENDAR"
    assert lines[-1] == "END:VCALENDAR"
    assert "VERSION:2.0" in lines
    assert "PRODID:-//StrikeHike//Upcoming dates//EN" in lines
    assert "CALSCALE:GREGORIAN" in lines
    assert "METHOD:PUBLISH" in lines
    assert "X-WR-CALNAME:StrikeHike · Science\\, Finance" in lines
    assert "X-WR-TIMEZONE:UTC" in lines
    assert "REFRESH-INTERVAL;VALUE=DURATION:P1D" in lines
    assert "X-PUBLISHED-TTL:P1D" in lines
    assert any(line.startswith("UID:") and line.endswith("@strikehike.com") for line in lines)
    assert len(physical) > 0

    events = vevents(lines)
    assert len(events) == 4
    for event in events:
        assert {"UID", "DTSTAMP", "DTSTART", "SUMMARY"} <= set(event)
    assert len({event["UID"] for event in events}) == len(events)
    assert all(event["DTSTAMP"] == "20261103T120000Z" for event in events)
    assert all(event["LAST-MODIFIED"] == "20261103T120000Z" for event in events)
    assert all(event["TRANSP"] == "TRANSPARENT" for event in events)

    solstice = next(event for event in events if "solstice" in event["UID"])
    assert unescape(solstice["SUMMARY"]) == LONG_NAME
    assert solstice["DTSTART"] == "20270315T123000Z"
    assert solstice["DTEND"] == "20270315T130000Z"
    assert "Listed by StrikeHike. Dates only" in solstice["DESCRIPTION"]
    assert "\\n" in solstice["DESCRIPTION"]

    all_day = next(event for event in events if "all-day" in event["UID"])
    assert all_day["DTSTART_PARAMS"] == "VALUE=DATE"
    assert all_day["DTEND_PARAMS"] == "VALUE=DATE"
    assert all_day["DTSTART"] == "20270303"
    assert all_day["DTEND"] == "20270304"

    cancelled = next(event for event in events if "cancelled" in event["UID"])
    assert cancelled["STATUS"] == "CANCELLED"

    finance = next(event for event in events if "decision" in event["UID"])
    assert finance["DTSTART"] == "20270313T131500Z"
    assert finance["DTEND"] == "20270313T134500Z"
    assert "Europe/Berlin" not in finance["DTSTART"]


def test_calendar_text_escaping_and_method_word():
    event = {
        "event_id": "science:test:escape",
        "name": "A; B, C\\D\nE",
        "theme": "Science",
        "start_date": "2027-03-05",
        "start_time": None,
        "timezone": None,
        "all_day": True,
        "status": "scheduled",
        "verification": "computed",
        "source_url": "https://example.com/source",
    }
    body = build_calendar(
        [event],
        [Theme.SCIENCE],
        created_at="2026-11-03T12:00:00Z",
    )
    _, lines = unfold(body)
    assert "SUMMARY:A\\; B\\, C\\\\D\\nE" in lines
    description = next(line for line in lines if line.startswith("DESCRIPTION:"))
    assert "Science · Method: https://example.com/source" in description
    assert "Dates only" in description


def test_empty_theme_is_a_valid_calendar(client):
    response = client.get("/api/v1/events/calendar.ics?themes=Politics")
    assert response.status_code == 200
    _, lines = unfold(response.content)
    assert lines[0] == "BEGIN:VCALENDAR"
    assert lines[-1] == "END:VCALENDAR"
    assert "X-WR-CALNAME:StrikeHike · Politics" in lines
    assert not any(line == "BEGIN:VEVENT" for line in lines)


def test_the_same_bundle_twice_is_byte_identical(client):
    first = client.get("/api/v1/events/calendar.ics?themes=Finance")
    second = client.get("/api/v1/events/calendar.ics?themes=Finance")
    assert first.content == second.content


def test_no_active_bundle_is_503(tmp_path, monkeypatch):
    monkeypatch.setenv("EVENTS_RUNTIME_DIR", str(tmp_path / "missing"))
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_today] = lambda: TODAY
    response = TestClient(app).get("/api/v1/events/calendar.ics")
    assert response.status_code == 503
