#!/usr/bin/env python3
"""Force-drop and reseed the historical events SQLite database.

This is intentionally a one-off operational script. It calls the canonical
seed/geometry pipeline with ``force=True``, which drops the existing
``historical_events`` table before rebuilding it from the JSON seed.
"""

from __future__ import annotations

import json
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from astro_finance.historical_parallels import (  # noqa: E402
    DB_PATH,
    SEED_PATH,
    seed_event_database,
)

CATEGORIES = (
    "Science",
    "Politics",
    "Finance",
    "Culture/Religion",
    "Natural Disasters",
)


def main() -> int:
    count = seed_event_database(force=True)

    with sqlite3.connect(DB_PATH) as connection:
        rows = connection.execute(
            """
            SELECT category, COUNT(*)
            FROM historical_events
            GROUP BY category
            ORDER BY category
            """
        ).fetchall()

    counts = {category: int(total) for category, total in rows}
    total = sum(counts.values())
    expected = len(
        json.loads(SEED_PATH.read_text(encoding="utf-8")).get("events", [])
    )

    print(f"Force-reseeded {count} events into {DB_PATH}")
    print(f"Seed source: {SEED_PATH}")
    print("Category counts:")
    for category in CATEGORIES:
        print(f"  {category}: {counts.get(category, 0)}")
    print(f"Total: {total}")

    if count != total or total != expected:
        print(
            f"ERROR: expected {expected} seeded events, "
            f"got count={count}, total={total}",
            file=sys.stderr,
        )
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
