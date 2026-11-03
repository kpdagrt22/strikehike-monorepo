"""Adapter for the curated historical seed (read-only, never modified)."""

from __future__ import annotations

import json
import os
from datetime import date, datetime
from pathlib import Path

from ..models import EventKind, EventStatus, RawRecord, Verification
from ..registry import SourceSpec
from . import SourceError, SourceExtraction


def seed_path_for(data_dir: Path) -> Path:
    override = os.environ.get("HISTORICAL_EVENTS_SEED", "").strip()
    if override:
        return Path(override)
    return data_dir.parent / "historical_events.json"


def extract(
    source: SourceSpec,
    *,
    today: date,
    now: datetime,
    data_dir: Path,
) -> SourceExtraction:
    path = seed_path_for(data_dir)
    if not path.exists():
        raise SourceError(f"historical seed not found: {path}")
    raw_bytes = path.read_bytes()
    try:
        payload = json.loads(raw_bytes.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise SourceError(f"historical seed is not valid UTF-8 JSON: {exc}") from exc

    records: list[RawRecord] = []
    for index, item in enumerate(payload.get("events", [])):
        if not isinstance(item, dict):
            raise SourceError(f"historical event {index} is not an object")
        records.append(
            RawRecord(
                source_id=source.id,
                name=str(item.get("name", "")),
                theme=str(item.get("category", "")),
                start_date=str(item.get("date", "")),
                description=str(item.get("description", "")),
                external_id=None,
                start_time=None,
                timezone=None,
                all_day=True,
                status=EventStatus.COMPLETED.value,
                source_url=source.url,
                verification=Verification.CURATED.value,
                kind=EventKind.HISTORICAL.value,
            )
        )

    return SourceExtraction(
        source_id=source.id,
        records=tuple(records),
        raw_payloads={path.name: raw_bytes},
        fetched_at=now,
    )
