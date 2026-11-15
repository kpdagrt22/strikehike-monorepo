from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest

from astro_finance.digest.content import RoundupNotFound
from astro_finance.roundups import router as router_module
from astro_finance.roundups.calendar import build_item_calendar, build_week_calendar
from astro_finance.roundups.router import router

BASE = "https://strikehike.com"
ROUNDUP = {
    "week": "2026-W47",
    "generated_at": "2026-11-14T13:12:14Z",
    "approved": True,
    "themes": [
        {
            "id": "finance",
            "name": "Finance",
            "events": [
                {
                    "id": "finance:test:cpi",
                    "name": "CPI, release; watch",
                    "start_date": "2026-11-18",
                    "start_time": "13:30:00",
                    "timezone": "America/New_York",
                    "start_utc": "2026-11-18T18:30:00Z",
                    "path": "/events/finance~test~cpi",
                }
            ],
        }
    ],
    "sky_week_items": [
        {
            "kind": "new_moon",
            "body": "Moon",
            "at": "2026-11-17T11:47:47Z",
            "path": "/upcoming/science",
            "label": "New moon",
        }
    ],
    "next_two_weeks": [
        {
            "id": "finance:fomc:2026-12",
            "name": "FOMC meeting",
            "start_date": "2026-12-09",
            "start_time": "14:00:00",
            "timezone": "America/New_York",
            "start_utc": "2026-12-09T19:00:00Z",
            "path": "/events/finance~fomc~2026-12",
        }
    ],
}


def _unfold(body: str) -> list[str]:
    return body.replace("\r\n ", "").split("\r\n")


def test_week_calendar_has_crlf_folding_escaping_and_stable_uids():
    body = build_week_calendar(ROUNDUP, BASE).decode("utf-8")
    unfolded = body.replace("\r\n ", "")
    assert body.count("\r\n") > 10
    assert "\n" not in body.replace("\r\n", "")
    assert body.startswith("BEGIN:VCALENDAR\r\n")
    assert body.endswith("END:VCALENDAR\r\n")
    assert body.count("BEGIN:VEVENT") == 3
    assert "UID:2026-W47-finance-test-cpi@strikehike.com" in body
    assert "UID:2026-W47-new-moon-moon-" in body
    assert "SUMMARY:CPI\\, release\\; watch" in body
    assert "DTSTART:20261118T183000Z" in body
    assert "DTEND:20261118T190000Z" in body
    assert "DTSTART:20261117T114747Z" in body
    assert "DTEND:20261117T120247Z" in body
    assert "DESCRIPTION:CPI\\, release\\; watch" in body
    assert "https://strikehike.com/events/finance~test~cpi" in unfolded
    assert "Descriptive context from StrikeHike\\, not investment advice." in unfolded
    for line in body.split("\r\n"):
        if not line:
            continue
        assert len(line.encode("utf-8")) <= 75, line


def test_single_item_calendar_and_unknown_key():
    body = build_item_calendar(ROUNDUP, BASE, "finance-test-cpi")
    assert body is not None
    text = body.decode("utf-8")
    assert text.count("BEGIN:VEVENT") == 1
    assert "UID:2026-W47-finance-test-cpi@strikehike.com" in text
    assert build_item_calendar(ROUNDUP, BASE, "not-here") is None


def test_router_serves_approved_week_and_404s_unknown(monkeypatch):
    monkeypatch.setenv("DIGEST_BASE_URL", BASE)
    monkeypatch.setattr(router_module, "fetch_roundup", lambda week: ROUNDUP)
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    client = TestClient(app)

    week = client.get("/api/v1/roundups/2026-W47/calendar.ics")
    assert week.status_code == 200
    assert week.headers["content-type"].startswith("text/calendar")
    assert week.headers["content-disposition"] == (
        'attachment; filename="strikehike-2026-W47.ics"'
    )
    assert week.headers["cache-control"] == "public, max-age=31536000, immutable"
    assert "BEGIN:VCALENDAR" in week.text

    item = client.get(
        "/api/v1/roundups/2026-W47/calendar/finance-test-cpi.ics"
    )
    assert item.status_code == 200
    assert "BEGIN:VEVENT" in item.text
    assert client.get(
        "/api/v1/roundups/2026-W47/calendar/not-here.ics"
    ).status_code == 404


def test_router_404s_an_unapproved_week(monkeypatch):
    def missing(week: str):
        raise RoundupNotFound("no approved roundup")

    monkeypatch.setattr(router_module, "fetch_roundup", missing)
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    client = TestClient(app)
    assert client.get("/api/v1/roundups/2026-W48/calendar.ics").status_code == 404
