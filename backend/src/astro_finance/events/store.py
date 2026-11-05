"""Read-only access to a built bundle, for the backend API."""

from __future__ import annotations

import json
import os
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
CALENDAR_STATUSES = (
    EventStatus.SCHEDULED.value,
    EventStatus.TENTATIVE.value,
    EventStatus.RESCHEDULED.value,
    EventStatus.CANCELLED.value,
)
MAX_LIMIT_PER_THEME = 50

# The pointer format is deliberately simple: a small text file named
# ``current`` containing a bundle directory (absolute, relative to the runtime
# directory, or a bare version under ``bundles/``).  Activation owns the atomic
# replacement; this module only resolves it.
DEFAULT_RUNTIME_DIR = Path(__file__).resolve().parents[3] / "data" / "runtime" / "events"
_POINTER_CACHE: dict[str, tuple[int, Path | None]] = {}


def runtime_dir_from_env() -> Path:
    value = os.environ.get("EVENTS_RUNTIME_DIR", "").strip()
    return Path(value) if value else DEFAULT_RUNTIME_DIR


def _resolve_current(runtime_dir: Path, pointer: Path) -> Path | None:
    try:
        text = pointer.read_text(encoding="utf-8").strip()
    except OSError:
        return None
    if not text:
        return None
    candidates: list[Path] = []
    raw = Path(text)
    candidates.append(raw if raw.is_absolute() else runtime_dir / raw)
    candidates.append(runtime_dir / "bundles" / text)
    for candidate in candidates:
        if (
            candidate.is_dir()
            and (candidate / "manifest.json").is_file()
            and (candidate / "events.sqlite").is_file()
        ):
            return candidate
    return None


def current_bundle_dir(runtime_dir: Path | None = None) -> Path | None:
    """Resolve the active bundle pointer, cached by the pointer's mtime."""

    runtime = Path(runtime_dir) if runtime_dir is not None else runtime_dir_from_env()
    pointer = runtime / "current"
    try:
        modified = pointer.stat().st_mtime_ns
    except OSError:
        _POINTER_CACHE.pop(str(runtime), None)
        return None
    key = str(runtime)
    cached = _POINTER_CACHE.get(key)
    if cached is not None and cached[0] == modified:
        return cached[1]
    resolved = _resolve_current(runtime, pointer)
    _POINTER_CACHE[key] = (modified, resolved)
    return resolved


def clear_bundle_cache(runtime_dir: Path | None = None) -> None:
    """Drop the pointer cache after an activation/rollback writes ``current``."""

    runtime = Path(runtime_dir) if runtime_dir is not None else runtime_dir_from_env()
    _POINTER_CACHE.pop(str(runtime), None)




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


def calendar_by_theme(
    db_path: Path,
    themes: list[str] | None = None,
    *,
    today: date,
    horizon_days: int = 365,
) -> dict[str, list[dict[str, Any]]]:
    """Every calendar event per theme: no display cap, cancelled dates kept."""

    if not isinstance(db_path, Path):
        db_path = Path(db_path)
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
              AND status IN (?, ?, ?, ?)
              AND start_date >= ? AND start_date <= ?
            ORDER BY start_date ASC,
                     COALESCE(start_time, '00:00:00') ASC,
                     event_id ASC
        """
        for theme in selected:
            rows = connection.execute(
                query,
                (
                    EventKind.UPCOMING.value,
                    theme.value,
                    *CALENDAR_STATUSES,
                    today.isoformat(),
                    horizon_end.isoformat(),
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


def upcoming_totals_by_theme(
    db_path: Path,
    themes: Iterable[str] | None = None,
    *,
    today: date,
    horizon_days: int = 365,
) -> dict[str, int]:
    """Count active upcoming events per theme before applying a display limit."""

    if not isinstance(db_path, Path):
        db_path = Path(db_path)
    horizon_end = today + timedelta(days=max(0, int(horizon_days)))
    selected = _normalise_themes(themes)
    totals = {theme.value: 0 for theme in selected}
    connection = _read_only_connection(db_path)
    try:
        rows = connection.execute(
            """
            SELECT theme, COUNT(*) AS count
            FROM events
            WHERE kind = ? AND status IN (?, ?)
              AND start_date >= ? AND start_date <= ?
            GROUP BY theme
            """,
            (
                EventKind.UPCOMING.value,
                *UPCOMING_STATUSES,
                today.isoformat(),
                horizon_end.isoformat(),
            ),
        ).fetchall()
    finally:
        connection.close()
    for row in rows:
        theme = str(row["theme"])
        if theme in totals:
            totals[theme] = int(row["count"])
    return totals


def empty_event_counts() -> dict[str, Any]:
    """The same shape as :func:`event_counts` when no bundle exists."""

    matrix: dict[str, dict[str, dict[str, int]]] = {
        theme.value: {
            kind.value: {status.value: 0 for status in EventStatus}
            for kind in EventKind
        }
        for theme in THEME_ORDER
    }
    return {"total": 0, "by_theme_kind_status": matrix}



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
