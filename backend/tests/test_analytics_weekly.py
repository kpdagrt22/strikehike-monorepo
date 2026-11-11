from __future__ import annotations

import json
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from astro_finance.analytics import router as router_module
from astro_finance.analytics import weekly as weekly_module
from astro_finance.analytics.router import router
from astro_finance.analytics.schema import validate_batch
from astro_finance.analytics.store import AnalyticsStore
from astro_finance.analytics.weekly import build_weekly_export, clear_weekly_cache

IST = ZoneInfo("Asia/Kolkata")
WEEK = "2026-W45"
NOW = datetime(2026, 11, 3, 12, tzinfo=IST)
PRIOR = datetime(2026, 10, 27, 12, tzinfo=IST)
TOKEN = "test-growth-token"


def event(name: str, when: datetime, pv: str, path: str = "/", **props):
    payload = {
        "n": name,
        "t": int(when.timestamp() * 1000),
        "pv": pv,
        "p": path,
        "pr": props,
    }
    if name == "page_viewed":
        payload["pr"] = {"nav_type": "load", "landing": 1, **props}
    return payload


def put(store: AnalyticsStore, aid: str, sid: str, events: list[dict], when: datetime, new: int = 1):
    envelope = {
        "v": 1,
        "aid": aid,
        "sid": sid,
        "new": new,
        "eph": 0,
        "ctx": {"vw": 390, "tz": "Asia/Kolkata", "app": "abc1234"},
        "exp": [],
        "ev": events,
    }
    parsed, valid, stripped, vis, _invalid = validate_batch(envelope)
    store.ingest(
        parsed,
        valid,
        vis,
        "Mozilla/5.0 (Windows NT 10.0) Chrome/124",
        f"net-{aid}",
        now_ms=int(when.timestamp() * 1000),
        stripped_props=stripped,
    )


def seeded_store(tmp_path):
    store = AnalyticsStore(tmp_path / "analytics.sqlite")
    new_a = "A" * 22
    new_b = "B" * 22
    returning = "C" * 22
    put(store, returning, "S" * 16, [event("page_viewed", PRIOR, "a" * 12)], PRIOR, new=1)
    put(
        store,
        new_a,
        "T" * 16,
        [
            event("page_viewed", NOW, "b" * 12),
            event(
                "date_travelled",
                NOW,
                "b" * 12,
                path="/regime",
                method="scrub",
                target_year=2020,
                is_future=0,
            ),
        ],
        NOW,
    )
    put(store, new_b, "U" * 16, [event("page_viewed", NOW, "c" * 12)], NOW)
    put(store, returning, "V" * 16, [event("page_viewed", NOW, "d" * 12)], NOW, new=0)
    store.record_drop("bot", 1, NOW)
    store.add_feedback(
        "The archive is useful.",
        "/regime?d=2026-11-03",
        "abc1234",
        "feedback-net",
        now_ms=int(NOW.timestamp() * 1000),
    )
    return store


def test_weekly_export_aggregates_and_suppresses_small_cells(tmp_path):
    store = seeded_store(tmp_path)
    logs = tmp_path / "logs"
    logs.mkdir()
    try:
        payload = build_weekly_export(store, WEEK, logs)
    finally:
        store.close()

    product = payload["product"]
    assert product["visitors"] == {
        "value": None,
        "reason": "insufficient data (n<5)",
    }
    assert product["new"]["value"] is None
    assert product["returning"]["value"] is None
    assert product["sessions"] == 3
    assert product["page_views"]["/"]["views"] == 3
    assert product["page_views"]["/"]["visitors"]["value"] is None
    assert product["events"]["page_viewed"]["count"] == 3
    assert product["events"]["date_travelled"]["count"] == 1
    assert product["activation_rate"]["value"] is None
    assert product["weekly_explorers"]["value"] is None
    assert product["weekly_returning_explorers"]["value"] is None
    assert product["retention"]["d1"]["value"] is None
    assert product["retention"]["d7"]["value"] is None
    # No experiment reported an exposure, so no experiment appears.
    assert product["experiments"] == {}
    assert payload["feedback"] == [
        {
            "day": "2026-11-03",
            "page": "/regime",
            "message": "The archive is useful.",
        }
    ]
    assert payload["data_quality"]["accepted"] == 4
    assert payload["data_quality"]["drops"]["bot"] == 1
    assert payload["data_quality"]["bot_share"] == 20.0
    assert payload["data_quality"]["suspect_bot_count"] == 1
    assert payload["server"]["requests"] == 0
    assert payload["server"]["calendar_feeds"]["science"]["feed_networks_approx"] == {
        "value": None,
        "reason": "insufficient data (n<5)",
    }
    assert payload["server"]["notes"]["feed_networks_approx"] == (
        "distinct masked networks, not people"
    )

    text = json.dumps(payload)
    assert "subscribers_approx" not in text
    for forbidden in ("A" * 22, "B" * 22, "C" * 22, "S" * 16, "T" * 16, "a" * 12, "b" * 12):
        assert forbidden not in text


@pytest.fixture
def api(tmp_path, monkeypatch):
    store = AnalyticsStore(tmp_path / "analytics.sqlite")
    logs = tmp_path / "logs"
    logs.mkdir()
    monkeypatch.setattr(router_module, "get_store", lambda: store)
    monkeypatch.setenv("GROWTH_EXPORT_TOKEN", TOKEN)
    monkeypatch.setenv("CADDY_LOG_DIR", str(logs))
    clear_weekly_cache()
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    yield TestClient(app), store
    clear_weekly_cache()
    store.close()


def weekly(client, headers=None):
    values = {"Authorization": f"Bearer {TOKEN}"}
    values.update(headers or {})
    return client.get("/api/v1/usage/weekly?week=2026-W45", headers=values)


def test_export_is_off_without_a_token_and_rejects_a_wrong_one(api, monkeypatch):
    client, _store = api
    monkeypatch.setenv("GROWTH_EXPORT_TOKEN", "")
    assert weekly(client).status_code == 404
    monkeypatch.setenv("GROWTH_EXPORT_TOKEN", TOKEN)
    assert weekly(client, {"Authorization": "Bearer wrong"}).status_code == 401
    assert weekly(client, {"Authorization": ""}).status_code == 401
    response = weekly(client)
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert weekly(client, {"Authorization": "Bearer wrong"}).status_code == 401


def test_export_suppresses_small_cells_and_contains_no_ids(api):
    client, store = api
    aid = "D" * 22
    sid = "W" * 16
    pv = "e" * 12
    put(store, aid, sid, [event("page_viewed", NOW, pv)], NOW)
    response = weekly(client)
    assert response.status_code == 200
    payload = response.json()
    assert payload["product"]["visitors"] == {
        "value": None,
        "reason": "insufficient data (n<5)",
    }
    assert payload["product"]["page_views"]["/"]["visitors"]["value"] is None
    text = response.text
    assert aid not in text
    assert sid not in text
    assert pv not in text


def test_export_uses_constant_time_comparison(api, monkeypatch):
    client, _store = api
    calls: list[tuple[bytes, bytes]] = []
    original = router_module.hmac.compare_digest

    def tracked(left, right):
        calls.append((left, right))
        return original(left, right)

    monkeypatch.setattr(router_module.hmac, "compare_digest", tracked)
    assert weekly(client).status_code == 200
    assert calls


@pytest.mark.parametrize("week", ["not-a-week", "2026-W5", "2026-W45 ", "2026-W54", "26-W45"])
def test_invalid_week_is_422(api, week):
    client, _store = api
    response = client.get(
        "/api/v1/usage/weekly",
        params={"week": week},
        headers={"Authorization": f"Bearer {TOKEN}"},
    )
    assert response.status_code == 422


class Clock:
    def __init__(self) -> None:
        self.now = 1_000.0

    def __call__(self) -> float:
        return self.now


@pytest.fixture
def counted(monkeypatch):
    clock = Clock()
    builds: list[str] = []
    original = weekly_module.build_weekly_export

    def build(store, week, log_dir):
        builds.append(week)
        return original(store, week, log_dir)

    monkeypatch.setattr(weekly_module, "_clock", clock)
    monkeypatch.setattr(weekly_module, "build_weekly_export", build)
    return clock, builds


def test_export_is_cached_for_ten_minutes_per_week(api, counted):
    client, store = api
    clock, builds = counted
    first = weekly(client)
    assert first.status_code == 200
    assert builds == [WEEK]

    # New data inside the window is not rescanned.
    put(store, "D" * 22, "W" * 16, [event("page_viewed", NOW, "e" * 12)], NOW)
    clock.now += 599
    second = weekly(client)
    assert second.status_code == 200
    assert second.json() == first.json()
    assert builds == [WEEK]

    other = client.get(
        "/api/v1/usage/weekly?week=2026-W44",
        headers={"Authorization": f"Bearer {TOKEN}"},
    )
    assert other.status_code == 200
    assert builds == [WEEK, "2026-W44"]

    clock.now += 1
    third = weekly(client)
    assert third.status_code == 200
    assert builds == [WEEK, "2026-W44", WEEK]
    assert third.json()["product"]["events"]["page_viewed"]["count"] == 1


def test_cached_export_still_requires_the_token(api, counted, monkeypatch):
    client, _store = api
    _clock, builds = counted
    assert weekly(client).status_code == 200
    assert weekly(client, {"Authorization": "Bearer wrong"}).status_code == 401
    assert weekly(client, {"Authorization": ""}).status_code == 401
    monkeypatch.setenv("GROWTH_EXPORT_TOKEN", "")
    assert weekly(client).status_code == 404
    assert builds == [WEEK]


def test_invalid_weeks_are_not_cached(api, counted):
    client, _store = api
    _clock, builds = counted
    for _ in range(2):
        response = client.get(
            "/api/v1/usage/weekly?week=2026-W99",
            headers={"Authorization": f"Bearer {TOKEN}"},
        )
        assert response.status_code == 422
    assert builds == ["2026-W99", "2026-W99"]
    assert weekly_module._cache == {}


def test_experiment_split_counts_engaged_sessions_per_variant(tmp_path):
    store = AnalyticsStore(tmp_path / "analytics.sqlite")
    try:
        # Two sessions saw "control", one saw "record". Only one control session
        # and the record session are engaged (a meaningful event each).
        put(
            store,
            "A" * 22,
            "S" * 16,
            [
                event("page_viewed", NOW, "a" * 12),
                event("experiment_exposed", NOW, "a" * 12, exp="home-cta", variant="control"),
                event(
                    "date_travelled",
                    NOW,
                    "a" * 12,
                    path="/regime",
                    method="scrub",
                    target_year=2020,
                    is_future=0,
                ),
            ],
            NOW,
        )
        put(
            store,
            "B" * 22,
            "T" * 16,
            [
                event("page_viewed", NOW, "b" * 12),
                event("experiment_exposed", NOW, "b" * 12, exp="home-cta", variant="control"),
            ],
            NOW,
        )
        put(
            store,
            "C" * 22,
            "U" * 16,
            [
                event("page_viewed", NOW, "c" * 12),
                event("experiment_exposed", NOW, "c" * 12, exp="home-cta", variant="record"),
                event(
                    "share_clicked",
                    NOW,
                    "c" * 12,
                    path="/tested/[claim]",
                    surface="tested",
                    method="clipboard",
                ),
            ],
            NOW,
        )
        logs = tmp_path / "logs"
        logs.mkdir()
        payload = build_weekly_export(store, WEEK, logs)
    finally:
        store.close()

    split = payload["product"]["experiments"]
    assert split == {
        "home-cta": {
            "assigned_sessions": 3,
            "engaged_sessions": 2,
            "variants": {"control": 1, "record": 1},
        }
    }
    # No ids leak into the export.
    text = json.dumps(payload)
    for aid in ("A" * 22, "B" * 22, "C" * 22):
        assert aid not in text


def put_ctx(store, aid, sid, events, when, vw, tz):
    envelope = {
        "v": 1,
        "aid": aid,
        "sid": sid,
        "new": 1,
        "eph": 0,
        "ctx": {"vw": vw, "tz": tz, "app": "abc1234"},
        "exp": [],
        "ev": events,
    }
    parsed, valid, stripped, vis, _invalid = validate_batch(envelope)
    store.ingest(
        parsed,
        valid,
        vis,
        "Mozilla/5.0 (Windows NT 10.0) Chrome/124",
        f"net-{aid}",
        now_ms=int(when.timestamp() * 1000),
        stripped_props=stripped,
    )


def test_v2_engagement_device_region_and_funnels(tmp_path):
    store = AnalyticsStore(tmp_path / "analytics.sqlite")
    letters = "DEFGHIJKLMNOP"
    # Six phone sessions in India: each views home and travels a date; the
    # first five also go Upcoming -> an event page -> its source.
    for index in range(6):
        aid = letters[index] * 22
        sid = letters[index] * 16
        pv = f"{index:x}" * 12
        rows = [
            event("page_viewed", NOW, pv),
            event(
                "date_travelled",
                NOW,
                pv,
                method="scrub",
                target_year=2020,
                is_future=0,
            ),
        ]
        if index < 5:
            rows += [
                event("page_viewed", NOW, pv, path="/upcoming"),
                event("page_viewed", NOW, pv, path="/events/[id]"),
                event(
                    "event_source_clicked",
                    NOW,
                    pv,
                    path="/events/[id]",
                    event_id="finance:fred_release_dates:53-2026-11",
                    theme="finance",
                ),
            ]
        put_ctx(store, aid, sid, rows, NOW, 390, "Asia/Kolkata")
    # Five desktop sessions in the US that only view a reference page.
    for index in range(6, 11):
        aid = letters[index] * 22
        sid = letters[index] * 16
        pv = f"{index:x}" * 12
        put_ctx(
            store,
            aid,
            sid,
            [event("page_viewed", NOW, pv, path="/recessions/[id]")],
            NOW,
            1440,
            "America/New_York",
        )
    logs = tmp_path / "logs"
    logs.mkdir()
    try:
        payload = build_weekly_export(store, WEEK, logs)
    finally:
        store.close()

    assert payload["export_version"] == 2
    product = payload["product"]
    assert product["engagement"]["sessions"] == {"value": 11}
    assert product["engagement"]["engaged_sessions"] == {"value": 6}
    assert product["engagement"]["engagement_rate"] == {"value": 54.5, "n": 11}

    phone = product["by_device"]["phone"]
    assert phone["sessions"] == {"value": 6}
    assert phone["engagement_rate"] == {"value": 100.0, "n": 6}
    desktop = product["by_device"]["desktop"]
    assert desktop["visitors"] == {"value": 5}
    assert desktop["engaged_sessions"]["value"] is None  # 0 is under five
    assert product["by_device"]["tablet"]["sessions"]["value"] is None

    assert product["by_region"]["IN"]["visitors"] == {"value": 6}
    assert product["by_region"]["US"]["sessions"] == {"value": 5}
    assert product["by_region"]["EU"]["visitors"]["value"] is None

    home, action = product["funnels"]["home_to_action"]
    assert home["sessions"] == {"value": 6} and home["from_previous"] is None
    assert action["sessions"] == {"value": 6}
    assert action["from_previous"] == {"value": 100.0, "n": 6}
    upcoming = product["funnels"]["upcoming_to_source"]
    assert [step["sessions"] for step in upcoming] == [{"value": 5}] * 3
    reference, shared = product["funnels"]["reference_to_share"]
    assert reference["sessions"] == {"value": 5}
    assert shared["sessions"]["value"] is None
    assert shared["from_previous"] == {"value": 0.0, "n": 5}

    # Nothing identifying leaves the export.
    text = json.dumps(payload)
    for index in range(11):
        assert letters[index] * 16 not in text
        assert letters[index] * 22 not in text
