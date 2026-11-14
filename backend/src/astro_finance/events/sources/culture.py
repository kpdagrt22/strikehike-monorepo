"""Deterministic Culture/Religion dates.

Western and Orthodox Easter use the standard computus. Chinese New Year uses
the second new moon after the December solstice in UTC+8. Rosh Hashanah and
Passover use Hebrew calendar arithmetic. Christmas is a fixed date.
"""

from __future__ import annotations

import json
from dataclasses import asdict
from datetime import date, datetime, timedelta, timezone

import swisseph as swe

from ..models import EventKind, EventStatus, RawRecord, Verification
from ..registry import SourceSpec
from . import SourceExtraction
from .astronomy import seasonal_events

FLAGS = swe.FLG_MOSEPH
UTC = timezone.utc
HEBREW_EPOCH = 347995.5


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


def _jd(value: datetime) -> float:
    return swe.julday(
        value.year,
        value.month,
        value.day,
        value.hour + value.minute / 60.0 + value.second / 3600.0,
        swe.GREG_CAL,
    )


def _datetime(value: float) -> datetime:
    year, month, day, hours = swe.revjul(value, swe.GREG_CAL)
    result = datetime(year, month, day, tzinfo=UTC) + timedelta(hours=hours)
    return (result + timedelta(microseconds=500_000)).replace(microsecond=0)


def _moon_sun_difference(jd: float) -> float:
    moon = float(swe.calc_ut(jd, swe.MOON, FLAGS)[0][0])
    sun = float(swe.calc_ut(jd, swe.SUN, FLAGS)[0][0])
    return ((moon - sun + 180.0) % 360.0) - 180.0


def next_new_moon(after: datetime) -> datetime:
    """The first new moon strictly after ``after`` (UTC)."""

    start = _jd(after)
    step = 0.25
    previous = start
    previous_delta = _moon_sun_difference(previous)
    limit = start + 40.0
    while previous < limit:
        current = min(previous + step, limit)
        current_delta = _moon_sun_difference(current)
        if previous_delta < 0.0 <= current_delta:
            low, high = previous, current
            for _ in range(50):
                middle = (low + high) / 2.0
                if _moon_sun_difference(middle) < 0.0:
                    low = middle
                else:
                    high = middle
            return _datetime((low + high) / 2.0)
        previous = current
        previous_delta = current_delta
    raise ValueError("no new moon found in the next 40 days")


def chinese_new_year(year: int) -> date:
    """The second new moon after the December solstice, in UTC+8.

    Chinese New Year always falls between 21 January and 20 February. In the
    rare year where the second new moon lands on 20 January (2015 and 2034 in
    the checked range), the next new moon is the new year; this is the leap
    month case the HKO table records.
    """

    solstice = next(
        (
            moment
            for name, stem, moment in seasonal_events(
                date(year - 1, 12, 1), date(year - 1, 12, 31)
            )
            if stem == "solstice-december"
        ),
        None,
    )
    if solstice is None:
        raise ValueError(f"no December solstice for {year - 1}")
    first = next_new_moon(solstice)
    second = next_new_moon(first + timedelta(days=1))
    result = (second + timedelta(hours=8)).date()
    if result < date(year, 1, 21):
        third = next_new_moon(second + timedelta(days=1))
        result = (third + timedelta(hours=8)).date()
    return result


def hebrew_leap(year: int) -> bool:
    return ((year * 7 + 1) % 19) < 7


def _hebrew_elapsed_days(year: int) -> int:
    """Days from the Hebrew epoch to 1 Tishrei of ``year``."""

    months = (
        235 * ((year - 1) // 19)
        + 12 * ((year - 1) % 19)
        + (7 * ((year - 1) % 19) + 1) // 19
    )
    parts = 204 + 793 * (months % 1080)
    hours = 5 + 12 * months + 793 * (months // 1080) + parts // 1080
    day = 1 + 29 * months + hours // 24
    parts = 1080 * (hours % 24) + parts % 1080
    if (
        parts >= 19440
        or (day % 7 == 2 and parts >= 9924 and not hebrew_leap(year))
        or (day % 7 == 1 and parts >= 16789 and hebrew_leap(year - 1))
    ):
        day += 1
    if day % 7 in (0, 3, 5):
        day += 1
    return day


def _hebrew_year_length(year: int) -> int:
    return _hebrew_elapsed_days(year + 1) - _hebrew_elapsed_days(year)


def _hebrew_month_lengths(year: int) -> dict[int, int]:
    leap = hebrew_leap(year)
    length = _hebrew_year_length(year) % 10
    cheshvan, kislev = (30, 30) if length == 5 else (29, 29) if length == 3 else (29, 30)
    months = {
        1: 30,
        2: 29,
        3: 30,
        4: 29,
        5: 30,
        6: 29,
        7: 30,
        8: cheshvan,
        9: kislev,
        10: 29,
        11: 30,
        12: 30 if leap else 29,
    }
    if leap:
        months[13] = 29
    return months


def _hebrew_to_jd(year: int, month: int, day: int) -> float:
    lengths = _hebrew_month_lengths(year)
    if month >= 7:
        elapsed = sum(lengths[m] for m in range(7, month))
    else:
        last = 13 if hebrew_leap(year) else 12
        elapsed = sum(lengths[m] for m in range(7, last + 1))
        elapsed += sum(lengths[m] for m in range(1, month))
    # Hebrew days begin at sunset; the published civil date is the daytime
    # that follows, one Gregorian day after the sunset instant.
    return HEBREW_EPOCH + _hebrew_elapsed_days(year) + elapsed + day


def _jd_to_gregorian(jd: float) -> date:
    return date(1970, 1, 1) + timedelta(days=round(jd - 2440587.5))


def rosh_hashanah(year: int) -> date:
    """1 Tishrei of the Hebrew year that begins in Gregorian ``year``."""

    hebrew_year = year + 3761
    return _jd_to_gregorian(_hebrew_to_jd(hebrew_year, 7, 1))


def passover(year: int) -> date:
    """15 Nisan of the Hebrew year that contains Passover in ``year``."""

    hebrew_year = year + 3760
    return _jd_to_gregorian(_hebrew_to_jd(hebrew_year, 1, 15))


def christmas(year: int) -> date:
    return date(year, 12, 25)


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
        computed = (
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
            (
                "Chinese New Year",
                "chinese-new-year",
                chinese_new_year(year),
                "https://www.hko.gov.hk/en/gts/time/conversion.htm",
                "Chinese New Year (the second new moon after the December solstice, "
                "as a date in UTC+8), an all-day date.",
            ),
            (
                "Rosh Hashanah",
                "rosh-hashanah",
                rosh_hashanah(year),
                "https://www.hebcal.com/",
                "Rosh Hashanah (1 Tishrei, Hebrew calendar arithmetic), an all-day "
                "date.",
            ),
            (
                "Passover",
                "passover",
                passover(year),
                "https://www.hebcal.com/",
                "Passover (15 Nisan, Hebrew calendar arithmetic), an all-day date.",
            ),
            (
                "Christmas",
                "christmas",
                christmas(year),
                "https://www.churchofengland.org/",
                "Christmas Day (fixed date), an all-day date.",
            ),
        )
        for name, external_stem, value, source_url, description in computed:
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
