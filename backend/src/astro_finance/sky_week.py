"""Read-only sky events and activity for one seven-day week.

Times are UTC. Sign ingresses use Swiss Ephemeris in Lahiri sidereal mode, the
same zodiac as the orrery and alignment panel. Moon phases, stations and
eclipses are zodiac-independent. Sky activity reuses the existing geometry
score and closest-past matcher; it describes geometry only.
"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from typing import Any

import swisseph as swe
from fastapi import APIRouter, HTTPException, Query

from astro_finance.events.sources.astronomy import (
    lunar_eclipses,
    seasonal_events,
    solar_eclipses,
)
from astro_finance.historical_parallels import find_historical_parallels

UTC = timezone.utc
TROPICAL = swe.FLG_MOSEPH
SIDEREAL = swe.FLG_MOSEPH | swe.FLG_SIDEREAL
swe.set_sid_mode(swe.SIDM_LAHIRI)

PLANETS = {
    "Mercury": swe.MERCURY,
    "Mars": swe.MARS,
    "Jupiter": swe.JUPITER,
    "Saturn": swe.SATURN,
}
INGRESS_BODIES = {
    "Sun": swe.SUN,
    "Mars": swe.MARS,
    "Jupiter": swe.JUPITER,
    "Saturn": swe.SATURN,
}
PHASES = (
    (0.0, "new_moon"),
    (90.0, "first_quarter"),
    (180.0, "full_moon"),
    (270.0, "last_quarter"),
)
SOURCE = "Swiss Ephemeris 2.10.03 · Lahiri sidereal"
ACTIVITY_NOTE = "Geometry match compares planet positions only; it predicts nothing."

router = APIRouter(prefix="/sky", tags=["sky"])


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
    moment = datetime(year, month, day, tzinfo=UTC) + timedelta(hours=hours)
    return (moment + timedelta(microseconds=500_000)).replace(microsecond=0)


def _iso(value: datetime) -> str:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def _longitude(jd: float, body: int, flags: int) -> float:
    return float(swe.calc_ut(jd, body, flags)[0][0]) % 360.0


def _wrap(value: float) -> float:
    return (value + 180.0) % 360.0 - 180.0


def _item(kind: str, body: str, moment: datetime, **extra: Any) -> dict[str, Any]:
    return {
        "kind": kind,
        "body": body,
        "at": _iso(moment),
        "path": "/upcoming/science",
        **extra,
    }


def moon_phases(start: datetime, end: datetime) -> list[dict[str, Any]]:
    found: list[dict[str, Any]] = []
    step = 0.25
    for target, kind in PHASES:
        cursor = _jd(start - timedelta(hours=12))
        limit = _jd(end + timedelta(hours=12))
        previous = cursor
        previous_delta = _wrap(_longitude(previous, swe.MOON, TROPICAL) - _longitude(previous, swe.SUN, TROPICAL) - target)
        while previous < limit:
            current = min(previous + step, limit)
            current_delta = _wrap(
                _longitude(current, swe.MOON, TROPICAL)
                - _longitude(current, swe.SUN, TROPICAL)
                - target
            )
            if previous_delta < 0.0 <= current_delta:
                low, high = previous, current
                for _ in range(50):
                    middle = (low + high) / 2.0
                    delta = _wrap(
                        _longitude(middle, swe.MOON, TROPICAL)
                        - _longitude(middle, swe.SUN, TROPICAL)
                        - target
                    )
                    if delta < 0.0:
                        low = middle
                    else:
                        high = middle
                moment = _datetime((low + high) / 2.0)
                if start <= moment <= end:
                    found.append(_item(kind, "Moon", moment))
            previous = current
            previous_delta = current_delta
    return sorted(found, key=lambda item: item["at"])


def stations(start: datetime, end: datetime) -> list[dict[str, Any]]:
    found: list[dict[str, Any]] = []
    step = 1.0

    def motion_at(jd: float, body: int) -> float:
        return _wrap(
            _longitude(jd + 0.01, body, TROPICAL)
            - _longitude(jd - 0.01, body, TROPICAL)
        )

    for name, body in PLANETS.items():
        cursor = _jd(start - timedelta(days=2))
        limit = _jd(end + timedelta(days=2))
        previous = cursor
        previous_motion = motion_at(previous, body)
        while previous < limit:
            current = min(previous + step, limit)
            motion = motion_at(current, body)
            if previous_motion > 0.0 >= motion or previous_motion < 0.0 <= motion:
                low, high = previous, current
                low_motion = previous_motion
                for _ in range(40):
                    middle = (low + high) / 2.0
                    middle_motion = motion_at(middle, body)
                    if (middle_motion > 0.0) == (low_motion > 0.0):
                        low = middle
                    else:
                        high = middle
                moment = _datetime((low + high) / 2.0)
                if start <= moment <= end:
                    found.append(
                        _item(
                            "station_retrograde" if low_motion > 0.0 else "station_direct",
                            name,
                            moment,
                        )
                    )
            previous = current
            previous_motion = motion
    return sorted(found, key=lambda item: item["at"])


def ingresses(start: datetime, end: datetime) -> list[dict[str, Any]]:
    found: list[dict[str, Any]] = []
    step = 1.0
    for name, body in INGRESS_BODIES.items():
        cursor = _jd(start - timedelta(days=2))
        limit = _jd(end + timedelta(days=2))
        previous = cursor
        previous_lon = _longitude(previous, body, SIDEREAL)
        previous_sign = int(previous_lon // 30.0) % 12
        while previous < limit:
            current = min(previous + step, limit)
            current_lon = _longitude(current, body, SIDEREAL)
            current_sign = int(current_lon // 30.0) % 12
            if current_sign != previous_sign:
                low, high = previous, current
                for _ in range(40):
                    middle = (low + high) / 2.0
                    sign = int(_longitude(middle, body, SIDEREAL) // 30.0) % 12
                    if sign == previous_sign:
                        low = middle
                    else:
                        high = middle
                moment = _datetime((low + high) / 2.0)
                if start <= moment <= end:
                    found.append(
                        _item(
                            "ingress",
                            name,
                            moment,
                            rashi=current_sign,
                        )
                    )
            previous = current
            previous_lon = current_lon
            previous_sign = current_sign
    return sorted(found, key=lambda item: item["at"])


def eclipses(start: datetime, end: datetime) -> list[dict[str, Any]]:
    found: list[dict[str, Any]] = []
    for kind, moment in solar_eclipses(start.date(), end.date()):
        if start <= moment <= end:
            found.append(
                _item("solar_eclipse", "Sun", moment, eclipse_type=kind)
            )
    for kind, moment in lunar_eclipses(start.date(), end.date()):
        if start <= moment <= end:
            found.append(
                _item("lunar_eclipse", "Moon", moment, eclipse_type=kind)
            )
    return sorted(found, key=lambda item: item["at"])


def seasons(start: datetime, end: datetime) -> list[dict[str, Any]]:
    found = []
    for name, stem, moment in seasonal_events(start.date(), end.date()):
        if start <= moment <= end:
            found.append(
                _item(
                    "season",
                    "Sun",
                    moment,
                    season=stem,
                    name=name,
                )
            )
    return sorted(found, key=lambda item: item["at"])


def conjunctions(start: datetime, end: datetime) -> list[dict[str, Any]]:
    found: list[dict[str, Any]] = []
    step = 1.0
    cursor = _jd(start - timedelta(days=2))
    limit = _jd(end + timedelta(days=2))
    previous = cursor

    def difference(jd: float) -> float:
        return _wrap(
            _longitude(jd, swe.MARS, SIDEREAL)
            - _longitude(jd, swe.SATURN, SIDEREAL)
        )

    previous_delta = difference(previous)
    while previous < limit:
        current = min(previous + step, limit)
        current_delta = difference(current)
        if (
            previous_delta < 0.0 <= current_delta
            and abs(previous_delta) < 90.0
            and abs(current_delta) < 90.0
        ):
            low, high = previous, current
            for _ in range(40):
                middle = (low + high) / 2.0
                if difference(middle) < 0.0:
                    low = middle
                else:
                    high = middle
            moment = _datetime((low + high) / 2.0)
            if start <= moment <= end:
                found.append(
                    _item("mars_saturn_conjunction", "Mars", moment)
                )
        previous = current
        previous_delta = current_delta
    return found


def activity(start: datetime, end: datetime) -> dict[str, Any]:
    daily = []
    cursor = start.date()
    while cursor < end.date():
        result = find_historical_parallels(cursor.isoformat(), limit=1)
        daily.append(
            {
                "date": cursor.isoformat(),
                "score": int(result["energy"]["score"]),
            }
        )
        cursor += timedelta(days=1)
    peak = max(daily, key=lambda item: (item["score"], item["date"]))
    peak_result = find_historical_parallels(peak["date"], limit=1)
    matches = peak_result.get("matches") or []
    closest = None
    if matches:
        match = matches[0]
        closest = {
            "date": match.get("date"),
            "name": match.get("name"),
            "similarity_percent": match.get("similarity_percent"),
        }
    return {
        "daily": daily,
        "min": min(item["score"] for item in daily),
        "max": peak["score"],
        "peak_date": peak["date"],
        "closest_past": closest,
        "note": ACTIVITY_NOTE,
    }


def sky_week(start: date) -> dict[str, Any]:
    begin = datetime.combine(start, time.min, tzinfo=UTC)
    end = begin + timedelta(days=7)
    return {
        "start": start.isoformat(),
        "end": (start + timedelta(days=6)).isoformat(),
        "source": SOURCE,
        "moon_phases": moon_phases(begin, end),
        "stations": stations(begin, end),
        "ingresses": ingresses(begin, end),
        "eclipses": eclipses(begin, end),
        "seasons": seasons(begin, end),
        "conjunctions": conjunctions(begin, end),
        "activity": activity(begin, end),
    }


@router.get("/week")
def get_sky_week(
    start: str = Query(
        ...,
        pattern=r"^\d{4}-\d{2}-\d{2}$",
        description="First day of the seven-day window, YYYY-MM-DD.",
    ),
) -> dict[str, Any]:
    try:
        day = date.fromisoformat(start)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="start must be YYYY-MM-DD") from exc
    return sky_week(day)
