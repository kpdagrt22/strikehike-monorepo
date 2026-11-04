from __future__ import annotations

import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from astro_finance.analytics import router as router_module
from astro_finance.analytics.router import feedback_router, router
from astro_finance.analytics.store import AnalyticsStore


def batch():
    return {
        "v": 1,
        "aid": "A" * 22,
        "sid": "B" * 16,
        "new": 1,
        "eph": 0,
        "ctx": {"vw": 390, "tz": "Asia/Kolkata", "app": "abc1234"},
        "exp": [],
        "ev": [
            {
                "n": "page_viewed",
                "t": 1_700_000_000_000,
                "pv": "a" * 12,
                "p": "/",
                "pr": {"nav_type": "load", "landing": 1},
            }
        ],
    }


@pytest.fixture
def client(tmp_path, monkeypatch):
    store = AnalyticsStore(tmp_path / "analytics.sqlite")
    monkeypatch.setattr(router_module, "get_store", lambda: store)
    monkeypatch.setenv("ANALYTICS_INGEST_ENABLED", "1")
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.include_router(feedback_router, prefix="/api/v1")
    yield TestClient(app), store
    store.close()


def post(client, body, headers=None):
    values = {
        "Origin": "https://strikehike.com",
        "User-Agent": "Mozilla/5.0 Chrome/124",
        "X-SH-Net": "net",
    }
    values.update(headers or {})
    return client.post("/api/v1/usage", content=json.dumps(body), headers=values)


def test_origin_size_bot_schema_and_kill_switch(client, monkeypatch):
    api, store = client
    assert post(api, batch(), {"Origin": "https://example.com"}).status_code == 403
    assert post(api, batch(), {"User-Agent": "Googlebot/2.1"}).status_code == 204
    assert store.connection.execute("SELECT dropped_bot FROM ingest_stats").fetchone()[0] == 1
    assert post(api, {"bad": "shape"}).status_code == 422

    monkeypatch.setenv("ANALYTICS_INGEST_ENABLED", "0")
    assert post(api, batch()).status_code == 204
    assert store.connection.execute("SELECT COUNT(*) FROM events").fetchone()[0] == 0


def test_size_cap_is_enforced_by_the_backend(client):
    api, _ = client
    response = api.post(
        "/api/v1/usage",
        content="x" * 9000,
        headers={
            "Origin": "https://strikehike.com",
            "User-Agent": "Mozilla/5.0 Chrome/124",
            "X-SH-Net": "net",
        },
    )
    assert response.status_code == 413


def test_gpc_drops_the_batch_and_valid_ingest_stores_it(client):
    api, store = client
    assert post(api, batch(), {"Sec-GPC": "1"}).status_code == 204
    assert store.connection.execute("SELECT COUNT(*) FROM events").fetchone()[0] == 0
    assert post(api, batch()).status_code == 204
    assert store.connection.execute("SELECT COUNT(*) FROM events").fetchone()[0] == 1


def test_feedback_validation_honeypot_and_rate_limit(client):
    api, store = client
    headers = {
        "Origin": "https://strikehike.com",
        "User-Agent": "Mozilla/5.0 Chrome/124",
        "X-SH-Net": "feedback-net",
    }

    def send(message, website=""):
        return api.post(
            "/api/v1/feedback",
            json={"message": message, "website": website, "path": "/", "app_version": "abc1234"},
            headers=headers,
        )

    assert send("This site is useful").status_code == 204
    assert send("Mail me at a@example.com").status_code == 422
    assert send("See https://example.com").status_code == 422
    assert send("See x.com").status_code == 422
    assert send("x" * 2).status_code == 422
    assert send("A real message", website="spam").status_code == 204
    assert store.connection.execute("SELECT COUNT(*) FROM feedback").fetchone()[0] == 1
    for _ in range(4):
        assert send("Another useful message").status_code == 204
    assert send("One too many").status_code == 429
