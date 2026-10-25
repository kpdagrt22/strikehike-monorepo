"""Historical event parallels: seeded SQLite store + geometry similarity search.

The event database is built from ``data/historical_events.json``. Swiss Ephemeris
(Lahiri sidereal) computes each event's geometry, and a 0-100 geometry energy
score is stored alongside it.

This energy score is intentionally geometry-only: most seeded events predate the
market ML frame (1992-2025), so a market volatility/regime score would not exist
for them. The endpoint uses the same geometry score for the target and the events.
"""

from __future__ import annotations

import json
import math
import os
import sqlite3
from datetime import date
from itertools import combinations
from pathlib import Path

import swisseph as swe

from astro_finance.energy_metric_compiler import (
    DESCRIPTIONS,
    DISRUPTIVE,
    FAVORABLE,
    NEUTRAL,
    POLARITY_SHORT,
)

PROJECT_ROOT = Path(__file__).resolve().parents[2]
SEED_PATH = Path(
    os.environ.get(
        "HISTORICAL_EVENTS_SEED",
        PROJECT_ROOT / "data" / "historical_events.json",
    )
)
DB_PATH = Path(
    os.environ.get(
        "HISTORICAL_EVENTS_DB",
        PROJECT_ROOT / "data" / "historical_events.db",
    )
)

MATCH_BODIES = [
    "Sun",
    "Mercury",
    "Venus",
    "Mars",
    "Jupiter",
    "Saturn",
    "Rahu",
    "Ketu",
]
ALL_BODIES = ["Sun", "Moon", *MATCH_BODIES[1:]]

BODY_IDS = {
    "Sun": swe.SUN,
    "Moon": swe.MOON,
    "Mercury": swe.MERCURY,
    "Venus": swe.VENUS,
    "Mars": swe.MARS,
    "Jupiter": swe.JUPITER,
    "Saturn": swe.SATURN,
    "Rahu": swe.MEAN_NODE,
    "Ketu": swe.MEAN_NODE,
}

WEIGHTS = {
    "Sun": 0.10,
    "Mercury": 0.10,
    "Venus": 0.10,
    "Mars": 0.15,
    "Jupiter": 0.20,
    "Saturn": 0.20,
    "Rahu": 0.10,
    "Ketu": 0.05,
}

MALEFIC_PAIRS = {
    ("Mars", "Saturn"): 0.30,
    ("Mars", "Rahu"): 0.20,
    ("Mars", "Ketu"): 0.20,
    ("Saturn", "Rahu"): 0.15,
    ("Saturn", "Ketu"): 0.15,
}

RETRO_BODIES = ["Mercury", "Venus", "Mars", "Jupiter", "Saturn"]
HARD_ASPECTS = ((0.0, 6.0), (90.0, 5.0), (180.0, 6.0))
MIN_GEOMETRY_BODIES = 3
MIN_DATE = date(1900, 1, 1)
MAX_DATE = date(2035, 12, 31)

FLAGS = swe.FLG_SWIEPH | swe.FLG_SIDEREAL | swe.FLG_SPEED
swe.set_sid_mode(swe.SIDM_LAHIRI)


def _angular_distance(a: float, b: float) -> float:
    return abs((a - b + 180.0) % 360.0 - 180.0)


def _is_hard_aspect(a: float, b: float) -> bool:
    separation = _angular_distance(a, b)
    return any(abs(separation - target) <= orb for target, orb in HARD_ASPECTS)


def geometry_for_date(date_str: str) -> dict:
    """Compute 9-body sidereal geometry at 00:00 UTC for a calendar date."""
    event_date = date.fromisoformat(date_str)
    if event_date < MIN_DATE or event_date > MAX_DATE:
        raise ValueError(
            f"Date must be between {MIN_DATE.isoformat()} and {MAX_DATE.isoformat()}."
        )

    julian_day = swe.julday(event_date.year, event_date.month, event_date.day, 0.0)
    geometry = {}

    for body, body_id in BODY_IDS.items():
        values, _ = swe.calc_ut(julian_day, body_id, FLAGS)
        longitude = values[0] % 360.0
        if body == "Ketu":
            longitude = (longitude + 180.0) % 360.0

        geometry[body] = {
            "lon": round(longitude, 2),
            "retro": bool(values[3] < 0),
        }

    return geometry


def geometry_energy_score(geometry: dict) -> int:
    """A 0-100 geometry-only energy score, consistent across all historical eras.

    Components:
      - malefic hard-aspect intensity (35%)
      - all-planet hard-aspect density (25%)
      - planetary concentration (25%)
      - retrograde share (15%)

    The Moon is stored in the event geometry but is not part of the score or the
    similarity match, matching the existing analog engine's deliberate exclusion
    of the fast-moving Moon.
    """
    available = [body for body in MATCH_BODIES if body in geometry]
    if not available:
        return 0

    available_pairs = [
        (a, b) for (a, b) in MALEFIC_PAIRS if a in geometry and b in geometry
    ]
    total_weight = sum(MALEFIC_PAIRS[pair] for pair in available_pairs)
    active_weight = sum(
        MALEFIC_PAIRS[(a, b)]
        for (a, b) in available_pairs
        if _is_hard_aspect(geometry[a]["lon"], geometry[b]["lon"])
    )
    malefic = active_weight / total_weight if total_weight else 0.0

    all_pairs = list(combinations(available, 2))
    hard_aspects = sum(
        1
        for a, b in all_pairs
        if _is_hard_aspect(geometry[a]["lon"], geometry[b]["lon"])
    )
    aspect_density = hard_aspects / len(all_pairs) if all_pairs else 0.0

    sin_sum = sum(
        math.sin(math.radians(geometry[body]["lon"])) for body in available
    )
    cos_sum = sum(
        math.cos(math.radians(geometry[body]["lon"])) for body in available
    )
    concentration = math.hypot(sin_sum, cos_sum) / len(available)

    retro_bodies = [body for body in RETRO_BODIES if body in geometry]
    retro_share = (
        sum(1 for body in retro_bodies if geometry[body].get("retro"))
        / len(retro_bodies)
        if retro_bodies
        else 0.0
    )

    raw = (
        0.35 * malefic
        + 0.25 * aspect_density
        + 0.25 * concentration
        + 0.15 * retro_share
    )
    return int(round(max(0.0, min(1.0, raw)) * 100))


DISRUPTIVE_SCORE = 28
FAVORABLE_SCORE = 18


def geometry_polarity(score: int) -> str:
    """Map the geometry energy score to the three canonical polarity states.

    These thresholds are calibrated to the geometry score's observed range
    (roughly 10-35 across the seeded events), not the market energy score range.
    """
    if score >= DISRUPTIVE_SCORE:
        return DISRUPTIVE
    if score <= FAVORABLE_SCORE:
        return FAVORABLE
    return NEUTRAL


def geometry_energy_object(score: int) -> dict:
    state = geometry_polarity(score)
    return {
        "score": int(score),
        "polarity": POLARITY_SHORT[state],
        "state": state,
        "description": DESCRIPTIONS[state],
        "source": "planetary_geometry",
    }


def _normalize_geometry(raw: dict | None) -> dict | None:
    """Accept {body: lon}, {body: {lon, retro}} or frontend-style {degree, retrograde}."""
    if not raw:
        return None

    normalized = {}
    for key, value in raw.items():
        body = next((item for item in ALL_BODIES if item.lower() == str(key).lower()), None)
        if body is None:
            continue

        if isinstance(value, dict):
            longitude = value.get("lon", value.get("degree", value.get("longitude")))
            retro = value.get("retro", value.get("retrograde", False))
        else:
            longitude = value
            retro = False

        if longitude is None:
            continue
        try:
            longitude = float(longitude) % 360.0
        except (TypeError, ValueError):
            continue

        normalized[body] = {
            "lon": round(longitude, 4),
            "retro": bool(retro),
        }

    if len([body for body in MATCH_BODIES if body in normalized]) < MIN_GEOMETRY_BODIES:
        raise ValueError(
            "geometry must include at least "
            f"{MIN_GEOMETRY_BODIES} of: {', '.join(MATCH_BODIES)}"
        )

    return normalized


def _similarity_percent(target: dict, event: dict) -> tuple[float, float]:
    """Return (geometry_similarity, longitude_similarity) on a 0-100 scale."""
    common = [
        body for body in MATCH_BODIES if body in target and body in event
    ]
    if not common:
        return 0.0, 0.0

    weights = {body: WEIGHTS[body] for body in common}
    total_weight = sum(weights.values())
    longitude_similarity = sum(
        weights[body]
        * (1.0 - _angular_distance(target[body]["lon"], event[body]["lon"]) / 180.0)
        for body in common
    ) / total_weight

    retro_common = [body for body in common if body in RETRO_BODIES]
    if retro_common:
        retro_weight = sum(WEIGHTS[body] for body in retro_common)
        retro_similarity = sum(
            WEIGHTS[body]
            * (
                1.0
                if bool(target[body].get("retro")) == bool(event[body].get("retro"))
                else 0.0
            )
            for body in retro_common
        ) / retro_weight
        geometry_similarity = 0.85 * longitude_similarity + 0.15 * retro_similarity
    else:
        geometry_similarity = longitude_similarity

    return round(geometry_similarity * 100.0, 1), round(
        longitude_similarity * 100.0, 1
    )


def _create_schema(connection: sqlite3.Connection, drop: bool = False) -> None:
    if drop:
        connection.execute("DROP TABLE IF EXISTS historical_events")

    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS historical_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            event_date TEXT NOT NULL,
            name TEXT NOT NULL,
            category TEXT NOT NULL
                CHECK (category IN ('Science', 'Politics', 'Finance')),
            description TEXT NOT NULL,
            geometry_json TEXT NOT NULL,
            energy_score INTEGER NOT NULL
                CHECK (energy_score BETWEEN 0 AND 100),
            UNIQUE(event_date, name)
        )
        """
    )
    connection.execute(
        "CREATE INDEX IF NOT EXISTS idx_events_date ON historical_events(event_date)"
    )
    connection.execute(
        "CREATE INDEX IF NOT EXISTS idx_events_category ON historical_events(category)"
    )
    connection.execute(
        "CREATE INDEX IF NOT EXISTS idx_events_energy ON historical_events(energy_score)"
    )


def seed_event_database(force: bool = False) -> int:
    """Create/seed the SQLite event database from the JSON seed.

    Returns the number of events available after seeding.
    """
    if not SEED_PATH.exists():
        raise FileNotFoundError(f"Historical event seed not found: {SEED_PATH}")

    DB_PATH.parent.mkdir(parents=True, exist_ok=True)

    connection = sqlite3.connect(DB_PATH)
    try:
        _create_schema(connection, drop=force)

        existing = connection.execute(
            "SELECT COUNT(*) FROM historical_events"
        ).fetchone()[0]
        if existing > 0 and not force:
            return int(existing)

        payload = json.loads(SEED_PATH.read_text(encoding="utf-8"))
        events = payload.get("events", [])
        if not events:
            raise ValueError("Historical event seed contains no events.")

        if force:
            connection.execute("DELETE FROM historical_events")

        rows = []
        for event in events:
            event_date = str(event["date"])
            geometry = geometry_for_date(event_date)
            score = geometry_energy_score(geometry)
            rows.append(
                (
                    event_date,
                    str(event["name"]),
                    str(event["category"]),
                    str(event["description"]),
                    json.dumps(geometry, separators=(",", ":")),
                    score,
                )
            )

        connection.executemany(
            """
            INSERT OR REPLACE INTO historical_events
                (event_date, name, category, description, geometry_json, energy_score)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            rows,
        )
        connection.commit()
        return len(rows)
    finally:
        connection.close()


def ensure_event_database() -> int:
    """Seed the database if it is missing or empty."""
    if DB_PATH.exists():
        connection = sqlite3.connect(DB_PATH)
        try:
            count = connection.execute(
                "SELECT COUNT(*) FROM historical_events"
            ).fetchone()[0]
            if count > 0:
                return int(count)
        except sqlite3.Error:
            pass
        finally:
            connection.close()

    return seed_event_database()


def _load_events() -> list[sqlite3.Row]:
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    try:
        return connection.execute(
            """
            SELECT event_date, name, category, description, geometry_json, energy_score
            FROM historical_events
            ORDER BY event_date
            """
        ).fetchall()
    finally:
        connection.close()


def find_historical_parallels(
    target_date: str,
    geometry: dict | None = None,
    limit: int = 3,
) -> dict:
    """Find 2-3 historical events with the closest planetary geometry/energy."""
    try:
        parsed_date = date.fromisoformat(target_date)
    except (TypeError, ValueError) as exc:
        raise ValueError("target date must be YYYY-MM-DD") from exc

    if parsed_date < MIN_DATE or parsed_date > MAX_DATE:
        raise ValueError(
            f"target date must be between {MIN_DATE.isoformat()} and {MAX_DATE.isoformat()}"
        )
    target_date = parsed_date.isoformat()

    limit = max(2, min(3, int(limit)))
    ensure_event_database()

    target_geometry = _normalize_geometry(geometry) if geometry else geometry_for_date(
        target_date
    )
    target_energy = geometry_energy_score(target_geometry)

    scored = []
    for row in _load_events():
        # A parallel is another moment in history, not the target event itself.
        if row["event_date"] == target_date:
            continue

        event_geometry = json.loads(row["geometry_json"])
        geometry_similarity, longitude_similarity = _similarity_percent(
            target_geometry, event_geometry
        )
        energy_delta = abs(target_energy - int(row["energy_score"]))
        energy_match = energy_delta <= 1

        bonus = 3 if energy_delta == 0 else 2 if energy_delta <= 1 else 1 if energy_delta <= 3 else 0
        similarity = min(100.0, round(geometry_similarity + bonus, 1))
        qualified = geometry_similarity >= 65.0 or energy_match

        scored.append(
            {
                "date": row["event_date"],
                "name": row["name"],
                "category": row["category"],
                "description": row["description"],
                "similarity_percent": similarity,
                "geometry_similarity_percent": geometry_similarity,
                "longitude_similarity_percent": longitude_similarity,
                "energy_score": int(row["energy_score"]),
                "energy_delta": energy_delta,
                "energy_match": energy_match,
                "_qualified": qualified,
            }
        )

    scored.sort(
        key=lambda item: (
            1 if item["_qualified"] else 0,
            item["similarity_percent"],
            -item["energy_delta"],
        ),
        reverse=True,
    )

    matches = scored[:limit]
    qualified_count = sum(1 for item in matches if item["_qualified"])
    low_confidence = qualified_count < 2
    for item in matches:
        item.pop("_qualified", None)

    return {
        "date": target_date,
        "target_energy_score": target_energy,
        "energy_source": "planetary_geometry",
        "energy": geometry_energy_object(target_energy),
        "geometry": target_geometry,
        "matches": matches,
        "method": (
            "weighted sidereal longitude (85%) + retrograde agreement (15%), "
            "with a geometry energy-score bonus"
        ),
        "low_confidence": low_confidence,
    }


__all__ = [
    "DB_PATH",
    "SEED_PATH",
    "ensure_event_database",
    "find_historical_parallels",
    "geometry_energy_score",
    "geometry_for_date",
    "seed_event_database",
]
