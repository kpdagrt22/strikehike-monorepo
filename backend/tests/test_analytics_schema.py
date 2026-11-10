from __future__ import annotations

from pathlib import Path

import pytest

from astro_finance.analytics.schema import PayloadTooLarge, ValidationError, load_schema, validate_batch

ROOT = Path(__file__).resolve().parents[2]
FRONTEND_SCHEMA = ROOT / "frontend" / "src" / "lib" / "analytics" / "schema.json"
BACKEND_SCHEMA = ROOT / "backend" / "src" / "astro_finance" / "analytics" / "schema.json"


def payload(**overrides):
    value = {
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
    value.update(overrides)
    return value


def test_the_two_schema_files_are_byte_identical():
    assert FRONTEND_SCHEMA.read_bytes() == BACKEND_SCHEMA.read_bytes()


def test_unknown_properties_are_stripped_and_counted():
    value = payload()
    value["ev"][0]["pr"]["not_allowed"] = "x"
    envelope, events, stripped, vis, invalid = validate_batch(value)
    assert envelope["aid"] == "A" * 22
    assert "not_allowed" not in events[0]["props"]
    assert stripped == 1
    assert vis == []
    assert invalid == 0


def test_required_properties_enums_paths_and_ids_are_enforced():
    # A bad event is dropped and counted; the envelope must still be valid.
    good = {"n": "page_viewed", "t": 1, "pv": "a" * 12, "p": "/", "pr": {"nav_type": "load", "landing": 1}}
    missing_required = {"n": "view_opened", "t": 1, "pv": "a" * 12, "p": "/", "pr": {"panel": "info"}}
    unknown_path = {"n": "page_viewed", "t": 1, "pv": "a" * 12, "p": "/elsewhere", "pr": {"nav_type": "load", "landing": 1}}
    bad_case = {"n": "case_opened", "t": 1, "pv": "a" * 12, "p": "/convergence",
                "pr": {"page": "/convergence", "slot": "a", "method": "deep_link", "case_id": "John Smith"}}
    _, events, _, _, invalid = validate_batch(payload(ev=[good, missing_required, unknown_path, bad_case]))
    assert [event["name"] for event in events] == ["page_viewed"]
    assert invalid == 3
    with pytest.raises(ValidationError):
        validate_batch(payload(aid="short"))


def test_depth_and_size_limits_are_enforced():
    value = payload()
    value["deep"] = {"a": {"b": {"c": {"d": {"e": 1}}}}}
    with pytest.raises(ValidationError):
        validate_batch(value)
    with pytest.raises(PayloadTooLarge):
        validate_batch(payload(), 9000)


def test_schema_has_the_sixteen_live_events_and_no_future_ones():
    names = set(load_schema()["events"])
    assert names == {
        "page_viewed",
        "onboarding_dismissed",
        "view_opened",
        "date_travelled",
        "asset_compared",
        "cycle_map_toggled",
        "case_opened",
        "upcoming_opened",
        "theme_selected",
        "event_source_clicked",
        "method_opened",
        "support_opened",
        "support_link_clicked",
        "feedback_submitted",
        "calendar_subscribed",
        "share_clicked",
    }
    assert "link_shared" not in names
    assert set(load_schema()["paths"]) == {
        "/",
        "/regime",
        "/convergence",
        "/patterns",
        "/disclaimer",
        "/upcoming",
        "/events/[id]",
        "/upcoming/[theme]",
        "/dates/[year]/[list]",
        "/recessions",
        "/recessions/[id]",
        "/declines",
        "/declines/[id]",
        "404",
    }


def test_calendar_subscribed_accepts_only_the_known_scopes_and_methods():
    good = {
        "n": "calendar_subscribed",
        "t": 1,
        "pv": "a" * 12,
        "p": "/upcoming",
        "pr": {"scope": "finance", "method": "copy"},
    }
    _, events, _, _, invalid = validate_batch(payload(ev=[good]))
    assert invalid == 0
    assert events[0]["props"] == {"scope": "finance", "method": "copy"}

    for props in (
        {"scope": "all", "method": "email"},
        {"scope": "politics", "method": "copy"},
        {"scope": "finance"},
    ):
        bad = {**good, "pr": props}
        _, events, _, _, invalid = validate_batch(payload(ev=[bad]))
        assert events == []
        assert invalid == 1


def test_share_clicked_accepts_only_the_known_surfaces_and_methods():
    good = {
        "n": "share_clicked",
        "t": 1,
        "pv": "a" * 12,
        "p": "/recessions/[id]",
        "pr": {"surface": "recession", "method": "clipboard"},
    }
    _, events, _, _, invalid = validate_batch(payload(ev=[good]))
    assert invalid == 0
    assert events[0]["props"] == {"surface": "recession", "method": "clipboard"}

    for props in (
        {"surface": "page", "method": "clipboard"},
        {"surface": "event", "method": "email"},
        {"surface": "event"},
    ):
        bad = {**good, "pr": props}
        _, events, _, _, invalid = validate_batch(payload(ev=[bad]))
        assert events == []
        assert invalid == 1
