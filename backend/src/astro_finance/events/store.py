"""Read-only access to a built bundle, for the backend API."""

from __future__ import annotations

import json
import sqlite3
from datetime import date, timedelta
from pathlib import Path
from typing import Any, Iterable

from .models import (
    THEME_ORDER,
    EventKind,
    EventStatus,
    SCHEMA_VERSION,
    Theme,
)

UPCOMING_STATUSES = (EventStatus.SCHEDULED.value, EventStatus.TENTATIVE.value)
MAX_LIMIT_PER_THEME = 20


def _normalise_themes(themes: Iterable[str] | None) -> list[Theme]:
    if themes is None:
        return list(THEME_ORDER)
    selected: list[Theme] = []
    for value in themes:
        try:
            theme = Theme(str(value))
        except ValueError as exc:
            raise ValueError(f"unknown theme: {value!r}") from exc
        if theme not in selected:
            selected.append(theme)
    return [theme for theme in THEME_ORDER if theme in selected]


def _read_only_connection(db_path: Path) -> sqlite3.Connection:
    uri = db_path.resolve().as_uri() + "?mode=ro"
    connection = sqlite3.connect(uri, uri=True)
    connection.row_factory = sqlite3.Row
    return connection


def upcoming_by_theme(
    db_path: Path,
    themes: list[str] | None = None,
    limit_per_theme: int = 5,
    *,
    today: date,
    horizon_days: int = 365,
) -> dict[str, list[dict[str, Any]]]:
    """Return active upcoming events, at most ``limit_per_theme`` per theme."""

    if not isinstance(db_path, Path):
        db_path = Path(db_path)
    limit = min(max(int(limit_per_theme), 1), MAX_LIMIT_PER_THEME)
    horizon_end = today + timedelta(days=max(0, int(horizon_days)))
    selected = _normalise_themes(themes)
    result: dict[str, list[dict[str, Any]]] = {theme.value: [] for theme in selected}
    connection = _read_only_connection(db_path)
    try:
        query = """
            SELECT event_id, name, theme, kind, start_date, start_time, timezone,
                   all_day, status, description, source_id, external_id,
                   source_url, first_discovered_at, last_updated_at, collected_at,
                   verification, supersedes, content_hash, days_until, missing_runs
            FROM events
            WHERE kind = ? AND theme = ?
              AND status IN (?, ?)
              AND start_date >= ? AND start_date <= ?
            ORDER BY start_date ASC,
                     COALESCE(start_time, '00:00:00') ASC,
                     event_id ASC
            LIMIT ?
        """
        for theme in selected:
            rows = connection.execute(
                query,
                (
                    EventKind.UPCOMING.value,
                    theme.value,
                    *UPCOMING_STATUSES,
                    today.isoformat(),
                    horizon_end.isoformat(),
                    limit,
                ),
            ).fetchall()
            result[theme.value] = [
                _row_to_dict(row, today=today) for row in rows
            ]
    finally:
        connection.close()
    return result


def _row_to_dict(row: sqlite3.Row, *, today: date) -> dict[str, Any]:
    payload = dict(row)
    payload["all_day"] = bool(payload["all_day"])
    payload["start_time"] = payload.get("start_time")
    payload["days_until"] = (
        date.fromisoformat(payload["start_date"]) - today
    ).days
    return payload


def event_counts(db_path: Path) -> dict[str, Any]:
    """Counts by theme, kind and status, with every combination present."""

    if not isinstance(db_path, Path):
        db_path = Path(db_path)
    matrix: dict[str, dict[str, dict[str, int]]] = {
        theme.value: {
            kind.value: {status.value: 0 for status in EventStatus}
            for kind in EventKind
        }
        for theme in THEME_ORDER
    }
    connection = _read_only_connection(db_path)
    try:
        rows = connection.execute(
            "SELECT theme, kind, status, COUNT(*) AS count FROM events "
            "GROUP BY theme, kind, status"
        ).fetchall()
    finally:
        connection.close()
    total = 0
    for row in rows:
        theme = str(row["theme"])
        kind = str(row["kind"])
        status = str(row["status"])
        if theme in matrix and kind in matrix[theme] and status in matrix[theme][kind]:
            matrix[theme][kind][status] = int(row["count"])
            total += int(row["count"])
    return {"total": total, "by_theme_kind_status": matrix}


def bundle_info(bundle_dir: Path) -> dict[str, Any]:
    """Read the manifest without loading events; used by the health endpoint."""

    if not isinstance(bundle_dir, Path):
        bundle_dir = Path(bundle_dir)
    manifest_path = bundle_dir / "manifest.json"
    if not manifest_path.exists():
        raise FileNotFoundError(f"bundle manifest not found: {manifest_path}")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    quality_path = bundle_dir / "quality_report.json"
    quality = (
        json.loads(quality_path.read_text(encoding="utf-8"))
        if quality_path.exists()
        else {}
    )
    return {
        "bundle_version": manifest.get("bundle_version"),
        "created_at": manifest.get("created_at"),
        "as_of": manifest.get("as_of"),
        "schema_version": manifest.get("schema_version", SCHEMA_VERSION),
        "counts": manifest.get("counts", {}),
        "publishable": manifest.get("publishable", False),
        "git_sha": manifest.get("git_sha"),
        "quality_summary": quality.get("summary", {}),
    }
