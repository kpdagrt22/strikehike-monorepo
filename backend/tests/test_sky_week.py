"""Tests for the read-only sky-week endpoint and its astronomy."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from fastapi import FastAPI
from fastapi.testclient import TestClient

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
    assert activity["closest_past"]["date"] < payload["start"]
    assert 0 <= activity["closest_past"]["similarity_percent"] <= 100
    assert activity["note"] == (
        "Geometry match compares planet positions only; it predicts nothing."
    )


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
