"""Deterministic Easter dates (Western and Orthodox) for Culture/Religion."""

from __future__ import annotations

import json
from dataclasses import asdict
from datetime import date, datetime, timedelta

from ..models import EventKind, EventStatus, RawRecord, Verification
from ..registry import SourceSpec
from . import SourceExtraction


def western_easter(year: int) -> date:
    """Anonymous Gregorian computus (the standard Western Easter algorithm)."""

    a = year % 19
    b, c = divmod(year, 100)
    d, e = divmod(b, 4)
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = divmod(c, 4)
    ell = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * ell) // 451
    month = (h + ell - 7 * m + 114) // 31
    day = ((h + ell - 7 * m + 114) % 31) + 1
    return date(year, month, day)


def _julian_to_gregorian(year: int, month: int, day: int) -> date:
    """Convert a Julian-calendar date to the Gregorian calendar (Richards)."""

    a = (14 - month) // 12
    y = year + 4800 - a
    m = month + 12 * a - 3
    jdn = day + (153 * m + 2) // 5 + 365 * y + y // 4 - 32083
    a = jdn + 32044
    b = (4 * a + 3) // 146097
    c = a - (146097 * b) // 4
    d = (4 * c + 3) // 1461
    e = c - (1461 * d) // 4
    m = (5 * e + 2) // 153
    day = e - (153 * m + 2) // 5 + 1
    month = m + 3 - 12 * (m // 10)
    year = 100 * b + d - 4800 + (m // 10)
    return date(year, month, day)


def orthodox_easter(year: int) -> date:
    """Meeus' Julian computus, converted to the Gregorian calendar."""

    a = year % 4
    b = year % 7
    c = year % 19
    d = (19 * c + 15) % 30
    e = (2 * a + 4 * b - d + 34) % 7
    month = (d + e + 114) // 31
    day = ((d + e + 114) % 31) + 1
    return _julian_to_gregorian(year, month, day)


def extract(
    source: SourceSpec,
    *,
    today: date,
    now: datetime,
) -> SourceExtraction:
    end = today + timedelta(days=source.horizon_days)
    records: list[RawRecord] = []
    for year in range(today.year, end.year + 1):
        for name, external_stem, value, source_url, description in (
            (
                "Western Easter",
                "western-easter",
                western_easter(year),
                "https://www.churchofengland.org/",
                "Western Easter (Gregorian computus), an all-day liturgical date.",
            ),
            (
                "Orthodox Easter",
                "orthodox-easter",
                orthodox_easter(year),
                "https://www.patriarchate.org/",
                "Orthodox Easter (Meeus Julian computus converted to the Gregorian "
                "calendar), an all-day liturgical date.",
            ),
        ):
            if not (today <= value <= end):
                continue
            records.append(
                RawRecord(
                    source_id=source.id,
                    name=f"{name} {year}",
                    theme="Culture/Religion",
                    start_date=value.isoformat(),
                    description=description,
                    external_id=f"{external_stem}-{year}",
                    start_time=None,
                    timezone=None,
                    all_day=True,
                    status=EventStatus.SCHEDULED.value,
                    source_url=source_url,
                    verification=Verification.COMPUTED.value,
                    kind=EventKind.UPCOMING.value,
                )
            )

    records.sort(key=lambda record: (record.start_date, record.name))
    payload = {
        "generated_for": today.isoformat(),
        "events": [asdict(record) for record in records],
    }
    return SourceExtraction(
        source_id=source.id,
        records=tuple(records),
        raw_payloads={
            "computed_events.json": json.dumps(
                payload, ensure_ascii=False, sort_keys=True
            ).encode("utf-8")
        },
        fetched_at=now,
    )
