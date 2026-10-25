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
    assert seeded_db == 129

    result = hp.find_historical_parallels("2008-09-15", limit=3)

    assert result["date"] == "2008-09-15"
    assert result["energy_source"] == "planetary_geometry"
    assert 2 <= len(result["matches"]) <= 3
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

    assert counts == {
        "Science": 35,
        "Politics": 35,
        "Finance": 24,
        "Culture/Religion": 20,
        "Natural Disasters": 15,
    }


def test_events_grouped_by_category(seeded_db):
    roster = hp.list_events_by_category()

    assert roster["total"] == 129
    assert set(roster["categories"]) == set(hp.EVENT_CATEGORIES)
    assert sum(len(events) for events in roster["categories"].values()) == 129
    assert len(roster["categories"]["Science"]) == 35
    assert len(roster["categories"]["Politics"]) == 35
    assert len(roster["categories"]["Finance"]) == 24
    assert len(roster["categories"]["Culture/Religion"]) == 20
    assert len(roster["categories"]["Natural Disasters"]) == 15


def test_provided_geometry_matches_date_geometry(seeded_db):
    geometry = hp.geometry_for_date("1947-08-15")
    result = hp.find_historical_parallels(
        "1947-08-15", geometry=geometry, limit=2
    )
    assert len(result["matches"]) == 2
    assert all(match["date"] != "1947-08-15" for match in result["matches"])
