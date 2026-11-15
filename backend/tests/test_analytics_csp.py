from __future__ import annotations

import json
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from astro_finance.analytics import csp as csp_module
from astro_finance.analytics.csp import router as csp_router
from astro_finance.analytics.store import AnalyticsStore, TokenBucket
from astro_finance.analytics.weekly import build_weekly_export

IST = ZoneInfo("Asia/Kolkata")
WEEK = "2026-W45"
NOW = datetime(2026, 11, 3, 12, tzinfo=IST)


@pytest.fixture
def client(tmp_path, monkeypatch):
    store = AnalyticsStore(tmp_path / "analytics.sqlite")
    monkeypatch.setattr(csp_module, "get_store", lambda: store)
    monkeypatch.setenv("ANALYTICS_INGEST_ENABLED", "1")
    app = FastAPI()
    app.include_router(csp_router, prefix="/api/v1")
    yield TestClient(app), store
    store.close()


def report_uri(**overrides):
    body = {
        "csp-report": {
            "document-uri": "https://strikehike.com/regime?case=2008#chart",
            "violated-directive": "script-src-elem",
            "blocked-uri": "https://cdn.example.com/lib.js?v=2",
        }
    }
    body["csp-report"].update(overrides)
    return body


def report_to(**overrides):
    body = {
        "type": "csp-violation",
        "body": {
            "documentURL": "https://strikehike.com/tested/full-moon?x=1",
            "effectiveDirective": "connect-src",
            "blockedURL": "https://api.example.com/collect?token=secret",
        },
    }
    body["body"].update(overrides)
    return [body]


def post(api, payload, headers=None):
    values = {
        "Origin": "https://strikehike.com",
        "Content-Type": "application/csp-report",
        "User-Agent": "Mozilla/5.0 Chrome/124",
        "Cookie": "session=abc",
        "Authorization": "Bearer secret-token",
        "X-SH-Net": "net",
    }
    values.update(headers or {})
    body = payload if isinstance(payload, str) else json.dumps(payload)
    return api.post("/api/v1/csp-report", content=body, headers=values)


def rows(store):
    return store.connection.execute(
        "SELECT directive, blocked_origin, page_path FROM csp_reports ORDER BY id"
    ).fetchall()


def test_report_uri_and_report_to_store_only_the_aggregate_fields(client):
    api, store = client
    assert post(api, report_uri()).status_code == 204
    assert post(api, report_to()).status_code == 204

    stored = rows(store)
    assert stored[0]["directive"] == "script-src-elem"
    # The blocked URL keeps its origin; the query is dropped.
    assert stored[0]["blocked_origin"] == "https://cdn.example.com"
    # The page keeps its path; the query and fragment are dropped.
    assert stored[0]["page_path"] == "/regime"

    assert stored[1]["directive"] == "connect-src"
    assert stored[1]["blocked_origin"] == "https://api.example.com"
    assert stored[1]["page_path"] == "/tested/full-moon"


def test_the_table_has_no_identity_columns(client):
    _, store = client
    columns = {
        row["name"]
        for row in store.connection.execute("PRAGMA table_info(csp_reports)")
    }
    assert columns == {
        "id",
        "received_at",
        "day_ist",
        "week_ist",
        "directive",
        "blocked_origin",
        "page_path",
    }
    # Nothing from the request headers can be stored even if it is sent.
    post(client[0], report_uri())
    text = json.dumps(
        [dict(row) for row in rows(store)],
        default=str,
    )
    assert "Mozilla" not in text
    assert "session=abc" not in text
    assert "secret-token" not in text


def test_origin_and_account_tokens_are_kept_as_tokens(client):
    api, store = client
    post(api, report_uri(**{"blocked-uri": "inline"}))
    post(api, report_uri(**{"blocked-uri": "eval"}))
    post(api, report_uri(**{"blocked-uri": "data"}))
    assert [row["blocked_origin"] for row in rows(store)] == [
        "inline",
        "eval",
        "data",
    ]


def test_a_foreign_document_uri_is_not_a_page_path(client):
    api, store = client
    post(
        api,
        report_uri(**{"document-uri": "https://evil.example/phish?x=1"}),
    )
    stored = rows(store)
    assert len(stored) == 1
    assert stored[0]["page_path"] == ""


def test_mismatched_origin_is_403_and_oversize_is_413(client):
    api, store = client
    assert post(api, report_uri(), {"Origin": "https://evil.example"}).status_code == 403
    assert post(api, report_uri(), {"Origin": ""}).status_code == 403
    assert rows(store) == []

    oversize = json.dumps(report_uri(**{"blocked-uri": "https://x.example/" + "a" * 8_500}))
    assert post(api, oversize).status_code == 413
    assert rows(store) == []


def test_the_per_network_limit_is_429(client, monkeypatch):
    api, store = client
    monkeypatch.setattr(store, "net_limit", TokenBucket(2, 3_600))
    assert post(api, report_uri()).status_code == 204
    assert post(api, report_uri()).status_code == 204
    assert post(api, report_uri()).status_code == 429
    assert len(rows(store)) == 2
    # A different network has its own bucket.
    assert post(api, report_uri(), {"X-SH-Net": "other"}).status_code == 204


def test_ingest_switch_off_accepts_and_stores_nothing(client, monkeypatch):
    api, store = client
    monkeypatch.setenv("ANALYTICS_INGEST_ENABLED", "0")
    assert post(api, report_uri()).status_code == 204
    assert rows(store) == []


def test_bad_json_is_422(client):
    api, _ = client
    assert post(api, "{not json").status_code == 422


def test_weekly_export_tops_the_directives_and_origins(tmp_path):
    store = AnalyticsStore(tmp_path / "analytics.sqlite")
    logs = tmp_path / "logs"
    logs.mkdir()
    try:
        for _ in range(3):
            store.add_csp_report(
                "script-src-elem",
                "https://cdn.example.com",
                "/regime",
                "net",
                now_ms=int(NOW.timestamp() * 1000),
            )
        for _ in range(2):
            store.add_csp_report(
                "connect-src",
                "https://api.example.com",
                "/upcoming",
                "net",
                now_ms=int(NOW.timestamp() * 1000),
            )
        store.add_csp_report(
            "img-src",
            "https://pixel.example.com",
            "/",
            "net",
            now_ms=int(NOW.timestamp() * 1000),
        )
        payload = build_weekly_export(store, WEEK, logs)
    finally:
        store.close()

    csp = payload["csp"]
    assert csp["total"] == 6
    assert csp["directives"][0] == {"name": "script-src-elem", "count": 3}
    assert csp["directives"][1] == {"name": "connect-src", "count": 2}
    assert csp["origins"][0] == {"name": "https://cdn.example.com", "count": 3}
    # Only names and counts, never a URL or an id.
    assert set(csp["origins"][0]) == {"name", "count"}


def test_the_daily_cap_drops_quietly_after_the_sample_is_full(client, monkeypatch):
    api, store = client
    monkeypatch.setattr("astro_finance.analytics.store.CSP_DAILY_CAP", 3)
    for _ in range(5):
        assert post(api, report_uri()).status_code == 204
    count = store.connection.execute("SELECT COUNT(*) AS n FROM csp_reports").fetchone()["n"]
    assert count == 3


def test_old_csp_rows_are_purged_with_the_other_tables(tmp_path):
    from astro_finance.analytics import store as store_module

    store = AnalyticsStore(tmp_path / "analytics.sqlite")
    try:
        now_ms = int(NOW.timestamp() * 1000)
        old_ms = now_ms - (store_module.RETENTION_DAYS + 2) * 86_400_000
        assert store.add_csp_report("img-src", "https://a.example", "/", "net", now_ms=old_ms)
        assert store.add_csp_report("img-src", "https://b.example", "/", "net", now_ms=now_ms)
        rows = store.connection.execute(
            "SELECT blocked_origin FROM csp_reports ORDER BY id"
        ).fetchall()
        assert [row["blocked_origin"] for row in rows] == ["https://b.example"]
    finally:
        store.close()
