"""Tests for the read-only sky-week endpoint and its astronomy."""

from __future__ import annotations

import re
import threading
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import swisseph as swe
from fastapi import FastAPI
from fastapi.testclient import TestClient

from astro_finance import sky_week as sky_week_module
from astro_finance.historical_parallels import geometry_for_date
from astro_finance.sky_week import router, sky_week

UTC = timezone.utc


def test_moon_phase_and_solar_eclipse_match_nasa():
    payload = sky_week(date(2024, 4, 8))
    new_moon = next(
        item for item in payload["moon_phases"] if item["kind"] == "new_moon"
    )
    moment = datetime.fromisoformat(new_moon["at"].replace("Z", "+00:00"))
    assert abs(moment - datetime(2024, 4, 8, 18, 21, tzinfo=UTC)) <= timedelta(hours=1)

    eclipse = next(
        item for item in payload["eclipses"] if item["kind"] == "solar_eclipse"
    )
    assert eclipse["eclipse_type"] == "total"
    assert datetime.fromisoformat(eclipse["at"].replace("Z", "+00:00")).date() == date(
        2024, 4, 8
    )


def test_mercury_station_and_sun_ingress_are_found():
    station_week = sky_week(date(2024, 4, 1))
    mercury = next(
        item
        for item in station_week["stations"]
        if item["body"] == "Mercury" and item["kind"] == "station_retrograde"
    )
    assert datetime.fromisoformat(mercury["at"].replace("Z", "+00:00")).date() == date(
        2024, 4, 1
    )

    ingress_week = sky_week(date(2024, 4, 8))
    sun = next(
        item for item in ingress_week["ingresses"] if item["body"] == "Sun"
    )
    assert sun["rashi"] == 0
    assert datetime.fromisoformat(sun["at"].replace("Z", "+00:00")).date() == date(
        2024, 4, 13
    )


def test_sky_activity_has_seven_days_and_a_closest_past_match():
    payload = sky_week(date(2026, 11, 16))
    activity = payload["activity"]
    assert len(activity["daily"]) == 7
    assert activity["min"] <= activity["max"]
    assert activity["peak_date"] in {item["date"] for item in activity["daily"]}
    closest = activity["closest_past"]
    assert closest["date"] < payload["start"]
    assert closest["for_date"] == payload["start"]
    assert closest["category"] == "Finance"
    assert closest["name"] == "Black Wednesday"
    assert closest["date"] == "1992-09-16"
    assert closest["similarity_percent"] == 79.5
    assert 0 <= closest["similarity_percent"] <= 100
    assert activity["note"] == (
        "Geometry match compares planet positions only; it predicts nothing."
    )


def test_sky_activity_returns_no_closest_when_every_match_is_hidden(monkeypatch):
    def fake(target_date, limit=1, **kwargs):
        return {
            "energy": {"score": 50},
            "matches": [
                {
                    "date": "1970-11-12",
                    "name": "Bhola cyclone",
                    "category": "Natural Disasters",
                    "similarity_percent": 80.4,
                },
                {
                    "date": "2024-11-05",
                    "name": "Trump wins US election",
                    "category": "Politics",
                    "similarity_percent": 78.2,
                },
            ],
        }

    monkeypatch.setattr(
        sky_week_module, "find_historical_parallels", fake
    )
    result = sky_week_module.activity(
        datetime(2026, 11, 16, tzinfo=UTC),
        datetime(2026, 11, 23, tzinfo=UTC),
    )
    assert result["closest_past"] is None


def test_hidden_categories_match_the_roundup_builder():
    builder = (
        Path(__file__).resolve().parents[2]
        / "frontend"
        / "scripts"
        / "roundup-build.mjs"
    )
    source = builder.read_text(encoding="utf-8")
    match = re.search(
        r"HIDDEN_THEMES\s*=\s*new Set\(\[(.*?)\]\)", source, re.S
    )
    assert match, "roundup-build.mjs must declare HIDDEN_THEMES"
    js_categories = {
        part.strip().strip("\"'")
        for part in match.group(1).split(",")
        if part.strip()
    }
    assert js_categories == set(sky_week_module.HIDDEN_CATEGORIES)


def test_every_sky_item_falls_inside_the_week():
    payload = sky_week(date(2026, 11, 16))
    start = datetime.fromisoformat(f"{payload['start']}T00:00:00+00:00")
    end = datetime.fromisoformat(f"{payload['end']}T23:59:59+00:00")
    for key in ("moon_phases", "stations", "ingresses", "eclipses", "seasons", "conjunctions"):
        for item in payload[key]:
            moment = datetime.fromisoformat(item["at"].replace("Z", "+00:00"))
            assert start <= moment <= end, (key, item)


def test_route_serves_a_week_and_rejects_a_bad_start():
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    client = TestClient(app)
    ok = client.get("/api/v1/sky/week?start=2024-04-08")
    assert ok.status_code == 200
    body = ok.json()
    assert body["start"] == "2024-04-08"
    assert body["end"] == "2024-04-14"
    assert body["moon_phases"]
    assert client.get("/api/v1/sky/week?start=not-a-date").status_code == 422


def test_route_serves_the_hidden_safe_closest_past():
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    client = TestClient(app)
    body = client.get("/api/v1/sky/week?start=2026-11-16").json()
    closest = body["activity"]["closest_past"]
    assert closest["name"] == "Black Wednesday"
    assert closest["category"] == "Finance"
    assert closest["for_date"] == "2026-11-16"
    assert closest["similarity_percent"] == 79.5


def test_lahiri_mode_survives_a_worker_thread_with_a_different_mode():
    result = {}

    def worker():
        swe.set_sid_mode(swe.SIDM_FAGAN_BRADLEY)
        result["geometry"] = geometry_for_date("2026-11-16")
        result["sky"] = sky_week(date(2026, 11, 16))

    thread = threading.Thread(target=worker)
    thread.start()
    thread.join()

    assert result["geometry"]["Sun"]["lon"] == 209.4
    ingress = next(
        item for item in result["sky"]["ingresses"] if item["body"] == "Sun"
    )
    assert ingress["at"] == "2026-11-16T14:13:13Z"


def test_real_api_server_historical_parallels_use_lahiri():
    from api_server import app as api_app

    client = TestClient(api_app)
    response = client.get(
        "/api/v1/historical-parallels?date=2026-11-16&limit=2"
    )
    assert response.status_code == 200
    matches = response.json()["matches"]
    assert [
        round(float(match["similarity_percent"]), 1) for match in matches
    ] == [81.3, 79.5, 78.8, 78.2]
