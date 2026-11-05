from __future__ import annotations

import json
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from astro_finance.analytics import router as router_module
from astro_finance.analytics.router import router
from astro_finance.analytics.schema import validate_batch
from astro_finance.analytics.store import AnalyticsStore
from astro_finance.analytics.weekly import build_weekly_export

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

    text = json.dumps(payload)
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
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    yield TestClient(app), store
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


def test_invalid_week_is_422(api):
    client, _store = api
    response = client.get(
        "/api/v1/usage/weekly?week=not-a-week",
        headers={"Authorization": f"Bearer {TOKEN}"},
    )
    assert response.status_code == 422
