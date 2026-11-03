"""Source adapters.  Each returns raw records plus the bytes it cached."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Any, Mapping

from ..models import RawRecord
from ..registry import SourceSpec


class SourceError(RuntimeError):
    """A source could not produce records; the message is safe to log."""


@dataclass(frozen=True, slots=True)
class SourceReject:
    source_id: str
    raw: Mapping[str, Any]
    reasons: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class SourceExtraction:
    source_id: str
    records: tuple[RawRecord, ...]
    raw_payloads: Mapping[str, bytes]
    fetched_at: datetime | None
    error: str | None = None
    rejects: tuple[SourceReject, ...] = ()


def extract_source(
    source: SourceSpec,
    *,
    today: date,
    now: datetime,
    data_dir: Path,
    offline_dir: Path | None = None,
) -> SourceExtraction:
    """Dispatch on the stable source id; unknown ids are a registry error."""

    from . import astronomy, culture, curated, fred, historical

    if source.id == "historical_curated":
        return historical.extract(source, today=today, now=now, data_dir=data_dir)
    if source.id == "fred_release_dates":
        return fred.extract(
            source, today=today, now=now, offline_dir=offline_dir
        )
    if source.id == "astronomy_computed":
        return astronomy.extract(source, today=today, now=now)
    if source.id == "culture_computed":
        return culture.extract(source, today=today, now=now)
    if source.id == "curated_upcoming":
        return curated.extract(source, today=today, now=now, data_dir=data_dir)
    raise SourceError(f"no extractor registered for source {source.id!r}")
