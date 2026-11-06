"""Fresh SQLite materialisation of the canonical event list."""

from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any

from .models import Event, SCHEMA_VERSION, iso_utc

EVENT_COLUMNS = (
    "event_id",
    "name",
    "theme",
    "kind",
    "start_date",
    "start_time",
    "timezone",
    "all_day",
    "status",
    "description",
    "source_id",
    "external_id",
    "source_url",
    "first_discovered_at",
    "last_updated_at",
    "collected_at",
    "verification",
    "supersedes",
    "content_hash",
    "days_until",
    "missing_runs",
    "authority_url",
)


def _row(event: Event) -> tuple[Any, ...]:
    return (
        event.event_id,
        event.name,
        event.theme.value,
        event.kind.value,
        event.start_date.isoformat(),
        event.start_time.isoformat() if event.start_time else None,
        event.timezone,
        1 if event.all_day else 0,
        event.status.value,
        event.description,
        event.source_id,
        event.external_id,
        event.source_url,
        iso_utc(event.first_discovered_at),
        iso_utc(event.last_updated_at),
        iso_utc(event.collected_at),
        event.verification.value,
        event.supersedes,
        event.content_hash,
        event.days_until,
        event.missing_runs,
        event.authority_url,
    )


def write_sqlite(path: Path, events: list[Event]) -> None:
    """Create a new database with the documented table and indexes."""

    if path.exists():
        path.unlink()
    connection = sqlite3.connect(path)
    try:
        connection.execute("PRAGMA page_size = 4096")
        connection.execute("PRAGMA auto_vacuum = NONE")
        connection.execute(
            "CREATE TABLE events ("
            "event_id TEXT PRIMARY KEY, "
            "name TEXT NOT NULL, "
            "theme TEXT NOT NULL, "
            "kind TEXT NOT NULL, "
            "start_date TEXT NOT NULL, "
            "start_time TEXT, "
            "timezone TEXT, "
            "all_day INTEGER NOT NULL CHECK (all_day IN (0, 1)), "
            "status TEXT NOT NULL, "
            "description TEXT NOT NULL, "
            "source_id TEXT NOT NULL, "
            "external_id TEXT, "
            "source_url TEXT NOT NULL, "
            "first_discovered_at TEXT NOT NULL, "
            "last_updated_at TEXT NOT NULL, "
            "collected_at TEXT NOT NULL, "
            "verification TEXT NOT NULL, "
            "supersedes TEXT, "
            "content_hash TEXT NOT NULL, "
            "days_until INTEGER, "
            "missing_runs INTEGER NOT NULL DEFAULT 0, "
            "authority_url TEXT"
            ")"
        )
        connection.execute(
            "CREATE INDEX idx_events_kind_theme_status_date "
            "ON events(kind, theme, status, start_date)"
        )
        connection.execute("CREATE INDEX idx_events_event_id ON events(event_id)")
        placeholders = ", ".join("?" for _ in EVENT_COLUMNS)
        connection.executemany(
            f"INSERT INTO events ({', '.join(EVENT_COLUMNS)}) VALUES ({placeholders})",
            [_row(event) for event in events],
        )
        connection.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
        connection.commit()
        connection.isolation_level = None
        connection.execute("VACUUM")
    finally:
        connection.close()
