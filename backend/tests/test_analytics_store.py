from __future__ import annotations

import time

from astro_finance.analytics import store as store_module
from astro_finance.analytics.schema import validate_batch
from astro_finance.analytics.store import AnalyticsStore, DailyCounter, TokenBucket


def event(name="view_opened", props=None, pv="a" * 12):
    return {
        "n": name,
        "t": 1_700_000_000_000,
        "pv": pv,
        "p": "/",
        "pr": props or ({"panel": "info", "method": "click"} if name == "view_opened" else {"nav_type": "load", "landing": 1}),
    }


def batch(aid="A" * 22, events=None, vis=None):
    return {
        "v": 1,
        "aid": aid,
        "sid": "B" * 16,
        "new": 1,
        "eph": 0,
        "ctx": {"vw": 390, "tz": "Asia/Kolkata", "app": "abc1234"},
        "exp": [],
        "ev": events if events is not None else [event()],
        "vis": vis or [],
    }


def put(store, envelope, *, net="net", now_ms=1_700_000_000_000):
    parsed, events, stripped, vis = validate_batch(envelope)
    return store.ingest(
        parsed,
        events,
        vis,
        "Mozilla/5.0 (Windows NT 10.0) Chrome/124",
        net,
        now_ms=now_ms,
        stripped_props=stripped,
    )


def test_net_and_aid_rate_limits(tmp_path):
    store = AnalyticsStore(tmp_path / "analytics.sqlite")
    try:
        accepted = sum(
            put(store, batch(aid=f"{i:022d}"[0:22]), net="same", now_ms=1_700_000_000_000)["accepted"]
            for i in range(121)
        )
        assert accepted == 120

        store2 = AnalyticsStore(tmp_path / "analytics2.sqlite")
        for index in range(3):
            result = put(store2, batch(events=[event() for _ in range(25)]), net=f"net-{index}")
            assert result["accepted"] == (25 if index < 2 else 0)

        store3 = AnalyticsStore(tmp_path / "analytics3.sqlite")
        store3.aid_minute = TokenBucket(100000, 60)
        for index in range(61):
            result = put(store3, batch(events=[event() for _ in range(25)]), net=f"net-{index}")
            assert result["accepted"] == (25 if index < 60 else 0)
    finally:
        store.close()
        store2.close()
        store3.close()


def test_derived_fields_and_referrer_class(tmp_path):
    store = AnalyticsStore(tmp_path / "analytics.sqlite")
    try:
        body = batch(
            events=[
                event(
                    "page_viewed",
                    {
                        "nav_type": "load",
                        "landing": 1,
                        "referrer_host": "news.ycombinator.com",
                    },
                )
            ]
        )
        put(store, body)
        row = store.connection.execute("SELECT * FROM events").fetchone()
        assert row["day_ist"] == "2023-11-15"
        assert row["week_ist"] == "2023-W46"
        assert row["device_class"] == "phone"
        assert row["geo_bucket"] == "IN"
        assert row["browser_family"] == "chrome"
        assert row["os_family"] == "windows"
        assert row["referrer_class"] == "community"
    finally:
        store.close()


def test_global_cap_and_kill_switch(tmp_path, monkeypatch):
    store = AnalyticsStore(tmp_path / "analytics.sqlite")
    monkeypatch.setattr(store_module, "GLOBAL_DAILY_CAP", 3)
    try:
        result = put(store, batch(events=[event() for _ in range(5)]), net="cap")
        assert result["accepted"] == 3
        assert result["dropped_global_cap"] == 2
        row = store.connection.execute("SELECT * FROM ingest_stats").fetchone()
        assert row["global_cap_hit"] == 1
    finally:
        store.close()


def test_vis_updates_max_win_and_are_capped(tmp_path):
    store = AnalyticsStore(tmp_path / "analytics.sqlite")
    try:
        put(store, batch(events=[event("page_viewed", {"nav_type": "load", "landing": 1})]))
        put(store, batch(events=[], vis=[{"pv": "a" * 12, "ms": 1000}]))
        put(store, batch(events=[], vis=[{"pv": "a" * 12, "ms": 500}]))
        put(store, batch(events=[], vis=[{"pv": "a" * 12, "ms": 2000, "lcp": 1200, "cls": 20}]))
        row = store.connection.execute("SELECT visible_ms, rum_lcp_ms, rum_cls_x1000 FROM events").fetchone()
        assert row["visible_ms"] == 2000
        assert row["rum_lcp_ms"] == 1200
        assert row["rum_cls_x1000"] == 20
    finally:
        store.close()


def test_retention_purges_old_events_on_the_first_insert_of_a_new_day(tmp_path):
    store = AnalyticsStore(tmp_path / "analytics.sqlite")
    old = 1_600_000_000_000
    new = old + 500 * 86_400_000
    try:
        put(store, batch(), now_ms=old)
        assert store.connection.execute("SELECT COUNT(*) FROM events").fetchone()[0] == 1
        put(store, batch(aid="C" * 22), net="new", now_ms=new)
        assert store.connection.execute("SELECT COUNT(*) FROM events").fetchone()[0] == 1
        assert store.connection.execute("SELECT received_at FROM events").fetchone()[0] == new
    finally:
        store.close()


def test_delete_aid_and_p95_for_a_25_event_batch(tmp_path):
    store = AnalyticsStore(tmp_path / "analytics.sqlite")
    try:
        put(store, batch(aid="D" * 22, events=[event() for _ in range(25)]))
        assert store.delete_aid("D" * 22) == 25

        timings = []
        for index in range(100):
            start = time.perf_counter()
            put(
                store,
                batch(aid=f"{index:022d}"[0:22], events=[event() for _ in range(25)]),
                net=f"perf-{index}",
                now_ms=1_700_000_000_000 + index,
            )
            timings.append((time.perf_counter() - start) * 1000)
        timings.sort()
        p95 = timings[int(len(timings) * 0.95) - 1]
        print(f"p95 25-event insert: {p95:.3f} ms")
        assert p95 < 50
    finally:
        store.close()


def test_cli_delete_aid_erases_only_that_id(tmp_path, capsys):
    from astro_finance.analytics.cli import main

    path = tmp_path / "analytics.sqlite"
    store = AnalyticsStore(path)
    try:
        put(store, batch(aid="E" * 22))
        put(store, batch(aid="F" * 22), net="other")
    finally:
        store.close()
    assert main(["--db", str(path), "delete", "--aid", "E" * 22]) == 0
    store = AnalyticsStore(path)
    try:
        assert store.connection.execute("SELECT COUNT(*) FROM events").fetchone()[0] == 1
        assert store.connection.execute("SELECT anon_id FROM events").fetchone()[0] == "F" * 22
    finally:
        store.close()
    assert "deleted" in capsys.readouterr().out


def test_daily_counter_resets_on_a_new_ist_day():
    counter = DailyCounter(2)
    assert counter.take("a", 2, "2026-11-04")
    assert not counter.take("a", 1, "2026-11-04")
    assert counter.take("a", 2, "2026-11-05")
