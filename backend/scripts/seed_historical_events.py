#!/usr/bin/env python3
"""Rebuild the historical parallels SQLite database from the JSON seed."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from astro_finance.historical_parallels import (  # noqa: E402
    DB_PATH,
    seed_event_database,
)


if __name__ == "__main__":
    count = seed_event_database(force=True)
    print(f"Seeded {count} historical events into {DB_PATH}")
