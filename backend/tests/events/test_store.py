from __future__ import annotations

import json
from datetime import time, timedelta

import pytest

from astro_finance.events.bundle import write_dataset
from astro_finance.events.models import EventKind, EventStatus, Theme
from astro_finance.events.store import bundle_info, event_counts, upcoming_by_theme
from conftest import NOW, TODAY, build_event


def _db(tmp_path):
    events = [
        build_event(
            event_id="politics:test:today",
            name="Today event",
            theme=Theme.POLITICS,
            start_date=TODAY,
            all_day=False,
            start_time=time(9, 0),
            timezone_name="UTC",
        ),
        build_event(
            event_id="science:test:late",
            name="Late event",
            theme=Theme.SCIENCE,
            start_date=TODAY + timedelta(days=10),
            all_day=False,
            start_time=time(10, 0),
            timezone_name="UTC",
        ),
        build_event(
            event_id="science:test:early",
            name="Early event",
            theme=Theme.SCIENCE,
            start_date=TODAY + timedelta(days=10),
            all_day=False,
            start_time=time(9, 0),
            timezone_name="UTC",
        ),
        build_event(
            event_id="science:test:tentative",
            name="Tentative event",
            theme=Theme.SCIENCE,
            start_date=TODAY + timedelta(days=20),
            status=EventStatus.TENTATIVE,
        ),
        build_event(
            event_id="science:test:cancelled",
            name="Cancelled event",
            theme=Theme.SCIENCE,
            start_date=TODAY + timedelta(days=5),
            status=EventStatus.CANCELLED,
        ),
        build_event(
            event_id="science:test:completed",
            name="Completed event",
            theme=Theme.SCIENCE,
            start_date=TODAY + timedelta(days=3),
            status=EventStatus.COMPLETED,
        ),
        build_event(
            event_id="science:test:unverified",
            name="Unverified event",
            theme=Theme.SCIENCE,
            start_date=TODAY + timedelta(days=4),
            status=EventStatus.UNVERIFIED,
        ),
        build_event(
            event_id="finance:test:far",
            name="Far event",
            theme=Theme.FINANCE,
            start_date=TODAY + timedelta(days=400),
        ),
        build_event(
            event_id="science:test:historical",
            name="Historical event",
            theme=Theme.SCIENCE,
            kind=EventKind.HISTORICAL,
            start_date=TODAY - timedelta(days=100),
        ),
    ]
    artifact = write_dataset(tmp_path / "staging", events, today=TODAY)
    return artifact.sqlite_path


def test_upcoming_by_theme_returns_all_themes_by_default(tmp_path):
    db = _db(tmp_path)
    result = upcoming_by_theme(db, None, 5, today=TODAY)
    assert list(result) == [
        "Politics",
        "Science",
        "Finance",
        "Culture/Religion",
        "Natural Disasters",
    ]
    assert [event["event_id"] for event in result["Science"]] == [
        "science:test:early",
        "science:test:late",
        "science:test:tentative",
    ]


def test_upcoming_by_theme_orders_same_day_by_time_then_id(tmp_path):
    db = _db(tmp_path)
    result = upcoming_by_theme(db, ["Science"], 5, today=TODAY)
    times = [event["start_time"] for event in result["Science"]]
    assert times == ["09:00:00", "10:00:00", None]


def test_upcoming_by_theme_excludes_past_cancelled_completed_and_unverified(tmp_path):
    db = _db(tmp_path)
    ids = {
        event["event_id"]
        for event in upcoming_by_theme(db, ["Science"], 20, today=TODAY)["Science"]
    }
    assert "science:test:cancelled" not in ids
    assert "science:test:completed" not in ids
    assert "science:test:unverified" not in ids
    assert "science:test:historical" not in ids


def test_upcoming_by_theme_caps_the_limit_and_respects_the_horizon(tmp_path):
    db = _db(tmp_path)
    limited = upcoming_by_theme(db, ["Science"], 1, today=TODAY)
    assert len(limited["Science"]) == 1
    capped = upcoming_by_theme(db, ["Science"], 99, today=TODAY)
    assert len(capped["Science"]) <= 20
    far = upcoming_by_theme(db, ["Finance"], 5, today=TODAY, horizon_days=400)
    assert [event["event_id"] for event in far["Finance"]] == ["finance:test:far"]
    near = upcoming_by_theme(db, ["Finance"], 5, today=TODAY, horizon_days=365)
    assert near["Finance"] == []


def test_upcoming_by_theme_accepts_a_theme_filter_and_rejects_unknown(tmp_path):
    db = _db(tmp_path)
    result = upcoming_by_theme(db, ["Finance", "Politics"], 5, today=TODAY)
    assert list(result) == ["Politics", "Finance"]
    with pytest.raises(ValueError, match="unknown theme"):
        upcoming_by_theme(db, ["Astrology"], 5, today=TODAY)


def test_upcoming_by_theme_caps_at_twenty(tmp_path):
    events = [
        build_event(
            event_id=f"science:test:{index}",
            name=f"Event {index}",
            theme=Theme.SCIENCE,
            start_date=TODAY + timedelta(days=index % 20),
        )
        for index in range(25)
    ]
    artifact = write_dataset(tmp_path / "many", events, today=TODAY)
    result = upcoming_by_theme(artifact.sqlite_path, ["Science"], 99, today=TODAY)
    assert len(result["Science"]) == 20


def test_the_connection_is_read_only(tmp_path):
    import sqlite3

    db = _db(tmp_path)
    connection = sqlite3.connect(db.resolve().as_uri() + "?mode=ro", uri=True)
    try:
        with pytest.raises(sqlite3.OperationalError):
            connection.execute("DELETE FROM events")
    finally:
        connection.close()


def test_upcoming_by_theme_recomputes_days_until(tmp_path):
    db = _db(tmp_path)
    result = upcoming_by_theme(db, ["Politics"], 5, today=TODAY)
    assert result["Politics"][0]["days_until"] == 0


def test_event_counts_has_the_zero_filled_matrix(tmp_path):
    db = _db(tmp_path)
    counts = event_counts(db)
    assert counts["total"] == 9
    assert counts["by_theme_kind_status"]["Politics"]["upcoming"]["scheduled"] == 1
    assert counts["by_theme_kind_status"]["Finance"]["upcoming"]["scheduled"] == 1
    assert counts["by_theme_kind_status"]["Science"]["historical"]["completed"] == 1


def test_bundle_info_reads_the_manifest_and_quality_summary(tmp_path):
    bundle = tmp_path / "bundle"
    bundle.mkdir()
    (bundle / "manifest.json").write_text(
        json.dumps(
            {
                "bundle_version": "abc123",
                "created_at": "2026-11-03T12:00:00Z",
                "schema_version": 1,
                "counts": {"total": 3},
                "publishable": True,
                "as_of": "2026-11-03",
            }
        ),
        encoding="utf-8",
    )
    (bundle / "quality_report.json").write_text(
        json.dumps({"summary": {"events_total": 3}}), encoding="utf-8"
    )
    info = bundle_info(bundle)
    assert info["bundle_version"] == "abc123"
    assert info["publishable"] is True
    assert info["quality_summary"] == {"events_total": 3}


def test_bundle_info_missing_manifest_raises(tmp_path):
    with pytest.raises(FileNotFoundError):
        bundle_info(tmp_path / "missing")
