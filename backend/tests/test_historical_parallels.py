import json
from datetime import date
from pathlib import Path

import pytest

from astro_finance import historical_parallels as hp


@pytest.fixture()
def seeded_db(tmp_path, monkeypatch):
    monkeypatch.setattr(hp, "DB_PATH", tmp_path / "historical_events.db")
    monkeypatch.setattr(
        hp,
        "SEED_PATH",
        Path(__file__).resolve().parents[1] / "data" / "historical_events.json",
    )
    count = hp.seed_event_database(force=True)
    return count


def _seed_events() -> list[dict]:
    path = Path(__file__).resolve().parents[1] / "data" / "historical_events.json"
    return json.loads(path.read_text(encoding="utf-8"))["events"]


def test_geometry_has_nine_bodies():
    geometry = hp.geometry_for_date("1969-07-16")
    assert set(geometry) == set(hp.ALL_BODIES)
    assert 0 <= geometry["Sun"]["lon"] < 360
    assert isinstance(geometry["Rahu"]["retro"], bool)


def test_energy_score_is_bounded():
    score = hp.geometry_energy_score(hp.geometry_for_date("2008-09-15"))
    assert isinstance(score, int)
    assert 0 <= score <= 100


def test_seed_and_query(seeded_db):
    events = _seed_events()
    assert seeded_db == len(events)

    result = hp.find_historical_parallels("2008-09-15")

    assert result["date"] == "2008-09-15"
    assert result["energy_source"] == "planetary_geometry"
    assert 2 <= len(result["matches"]) <= 4
    assert all(0 <= match["similarity_percent"] <= 100 for match in result["matches"])
    assert all(match["date"] != "2008-09-15" for match in result["matches"])
    assert {match["category"] for match in result["matches"]} <= {
        "Science",
        "Politics",
        "Finance",
        "Culture/Religion",
        "Natural Disasters",
    }


def test_seed_category_distribution(seeded_db):
    import sqlite3

    with sqlite3.connect(hp.DB_PATH) as connection:
        counts = dict(
            connection.execute(
                """
                SELECT category, COUNT(*)
                FROM historical_events
                GROUP BY category
                """
            ).fetchall()
        )

    expected = {}
    for event in _seed_events():
        expected[event["category"]] = expected.get(event["category"], 0) + 1

    assert counts == expected


def test_recent_events_expanded():
    events = _seed_events()
    recent = [
        event
        for event in events
        if date.fromisoformat(event["date"]) >= date(2020, 1, 1)
    ]

    assert len(recent) >= 25
    assert all(
        date.fromisoformat(event["date"]) <= date(2026, 12, 31)
        for event in recent
    )
    assert all(
        len(event["date"]) == 10
        and date.fromisoformat(event["date"]).isoformat() == event["date"]
        for event in events
    )


def test_events_grouped_by_category(seeded_db):
    events = _seed_events()
    roster = hp.list_events_by_category()

    assert roster["total"] == len(events)
    assert set(roster["categories"]) == set(hp.EVENT_CATEGORIES)
    assert (
        sum(len(category_events) for category_events in roster["categories"].values())
        == len(events)
    )


def test_crisis_waypoints_are_calibrated_above_85(seeded_db):
    for waypoint in ("2008-09-15", "1929-10-24"):
        result = hp.find_historical_parallels(waypoint)
        assert result["energy"]["score"] > 85
        assert result["energy"]["calibration"] in {
            "stress_window",
            "historical_percentile",
        }
        assert result["energy"]["raw_score"] <= 100


def test_dual_epoch_partition(seeded_db):
    result = hp.find_historical_parallels("2008-09-15")

    assert result["epoch_cutoff_year"] == 2015
    assert set(result["epochs"]) == {"historical", "recent"}
    assert len(result["matches"]) == 4

    for epoch, cutoff_test in (
        ("historical", lambda event_date: event_date.year < 2015),
        ("recent", lambda event_date: event_date.year >= 2015),
    ):
        picks = result["epochs"][epoch]
        assert len(picks) == 2
        assert all(pick["epoch"] == epoch for pick in picks)
        assert all(
            cutoff_test(date.fromisoformat(pick["date"])) for pick in picks
        )
        assert all(
            pick["epoch_label"]
            == ("Historical Parallels" if epoch == "historical" else "Recent Manifestations")
            for pick in picks
        )


def test_forecast_ladder_returns_qualified_upcoming_matches(seeded_db):
    result = hp.forecast_ladder(days=180, threshold=85, limit=3)

    assert result["window_days"] == 180
    assert result["threshold"] == 85
    assert len(result["matches"]) <= 3
    assert len(result["matches"]) == result["unique_events"]
    assert all(match["similarity_percent"] >= 85 for match in result["matches"])
    assert all(match["days_ahead"] >= 1 for match in result["matches"])

    names = [match["event"]["name"] for match in result["matches"]]
    assert len(names) == len(set(names))


def test_peak_forecast_matches_collapses_event_clusters():
    matches = [
        {
            "date": "2026-11-01",
            "days_ahead": 6,
            "similarity_percent": 91.0,
            "event": {"name": "MLK Jr. assassination"},
        },
        {
            "date": "2026-11-02",
            "days_ahead": 7,
            "similarity_percent": 93.4,
            "event": {"name": "MLK Jr. assassination"},
        },
        {
            "date": "2026-11-03",
            "days_ahead": 8,
            "similarity_percent": 90.0,
            "event": {"name": "MLK Jr. assassination"},
        },
        {
            "date": "2026-12-01",
            "days_ahead": 36,
            "similarity_percent": 89.0,
            "event": {"name": "First Moon landing"},
        },
        {
            "date": "2026-12-02",
            "days_ahead": 37,
            "similarity_percent": 88.0,
            "event": {"name": "First Moon landing"},
        },
        {
            "date": "2026-12-20",
            "days_ahead": 55,
            "similarity_percent": 86.0,
            "event": {"name": "Fall of the Berlin Wall"},
        },
    ]

    result = hp._peak_forecast_matches(matches, 3)

    assert [match["event"]["name"] for match in result] == [
        "MLK Jr. assassination",
        "First Moon landing",
        "Fall of the Berlin Wall",
    ]
    assert [match["date"] for match in result] == [
        "2026-11-02",
        "2026-12-01",
        "2026-12-20",
    ]
    assert result[0]["days_ahead"] == 7


def test_provided_geometry_matches_date_geometry(seeded_db):
    geometry = hp.geometry_for_date("1947-08-15")
    result = hp.find_historical_parallels(
        "1947-08-15", geometry=geometry, limit=2
    )
    assert len(result["matches"]) == 4
    assert all(match["date"] != "1947-08-15" for match in result["matches"])
