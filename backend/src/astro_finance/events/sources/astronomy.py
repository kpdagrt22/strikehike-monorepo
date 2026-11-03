"""Deterministic astronomy events: eclipses, equinoxes and solstices.

Swiss Ephemeris' Moshier mode (``FLG_MOSEPH``) is used so the result does not
depend on ephemeris files installed on the runner.  All times are UTC.
"""

from __future__ import annotations

import json
from dataclasses import asdict
from datetime import date, datetime, timedelta, timezone

import swisseph as swe

from ..models import EventKind, EventStatus, RawRecord, Verification
from ..registry import SourceSpec
from . import SourceExtraction

FLAGS = swe.FLG_MOSEPH
UTC = timezone.utc


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


def _solar_type(retflag: int) -> str:
    if retflag & swe.ECL_ANNULAR_TOTAL:
        return "hybrid"
    if retflag & swe.ECL_TOTAL:
        return "total"
    if retflag & swe.ECL_ANNULAR:
        return "annular"
    return "partial"


def _lunar_type(retflag: int) -> str:
    if retflag & swe.ECL_TOTAL:
        return "total"
    if retflag & swe.ECL_PARTIAL:
        return "partial"
    return "penumbral"


def solar_eclipses(start: date, end: date) -> list[tuple[str, datetime]]:
    cursor = _jd(datetime(start.year, start.month, start.day, tzinfo=UTC))
    end_jd = _jd(
        datetime(end.year, end.month, end.day, tzinfo=UTC) + timedelta(days=1)
    )
    found: list[tuple[str, datetime]] = []
    for _ in range(12):
        retflag, tret = swe.sol_eclipse_when_glob(cursor, FLAGS, 0)
        moment = _datetime(tret[0])
        if _jd(moment) > end_jd:
            break
        if moment.date() >= start and moment.date() <= end:
            found.append((_solar_type(retflag), moment))
        cursor = tret[0] + 1.0
    return found


def lunar_eclipses(start: date, end: date) -> list[tuple[str, datetime]]:
    cursor = _jd(datetime(start.year, start.month, start.day, tzinfo=UTC))
    end_jd = _jd(
        datetime(end.year, end.month, end.day, tzinfo=UTC) + timedelta(days=1)
    )
    found: list[tuple[str, datetime]] = []
    for _ in range(12):
        retflag, tret = swe.lun_eclipse_when(cursor, FLAGS, 0)
        moment = _datetime(tret[0])
        if _jd(moment) > end_jd:
            break
        if moment.date() >= start and moment.date() <= end:
            found.append((_lunar_type(retflag), moment))
        cursor = tret[0] + 1.0
    return found


def _sun_longitude(jd: float) -> float:
    return float(swe.calc_ut(jd, swe.SUN, FLAGS)[0][0])


def _delta(jd: float, target: float) -> float:
    return ((_sun_longitude(jd) - target + 180.0) % 360.0) - 180.0


def _crossing(start_jd: float, end_jd: float, target: float) -> float | None:
    step = 0.25
    previous_jd = start_jd
    previous_delta = _delta(previous_jd, target)
    while previous_jd < end_jd:
        current_jd = min(previous_jd + step, end_jd)
        current_delta = _delta(current_jd, target)
        if previous_delta < 0.0 <= current_delta:
            low, high = previous_jd, current_jd
            for _ in range(50):
                middle = (low + high) / 2.0
                if _delta(middle, target) < 0.0:
                    low = middle
                else:
                    high = middle
            return (low + high) / 2.0
        previous_jd = current_jd
        previous_delta = current_delta
    return None


def seasonal_events(start: date, end: date) -> list[tuple[str, str, datetime]]:
    """Return ``(name, external stem, moment)`` for equinoxes and solstices."""

    start_jd = _jd(datetime(start.year, start.month, start.day, tzinfo=UTC))
    end_jd = _jd(datetime(end.year, end.month, end.day, tzinfo=UTC) + timedelta(days=1))
    definitions = (
        (0.0, "March equinox", "equinox-march"),
        (90.0, "June solstice", "solstice-june"),
        (180.0, "September equinox", "equinox-september"),
        (270.0, "December solstice", "solstice-december"),
    )
    found: list[tuple[str, str, datetime]] = []
    for target, name, stem in definitions:
        moment_jd = _crossing(start_jd, end_jd, target)
        if moment_jd is None:
            continue
        moment = _datetime(moment_jd)
        if start <= moment.date() <= end:
            found.append((name, stem, moment))
    return sorted(found, key=lambda item: item[2])


def _record(
    source: SourceSpec,
    *,
    name: str,
    external_id: str,
    moment: datetime,
    description: str,
) -> RawRecord:
    return RawRecord(
        source_id=source.id,
        name=name,
        theme="Science",
        start_date=moment.date().isoformat(),
        description=description,
        external_id=external_id,
        start_time=moment.time().isoformat(timespec="seconds"),
        timezone="UTC",
        all_day=False,
        status=EventStatus.SCHEDULED.value,
        source_url=source.url,
        verification=Verification.COMPUTED.value,
        kind=EventKind.UPCOMING.value,
    )


def extract(
    source: SourceSpec,
    *,
    today: date,
    now: datetime,
) -> SourceExtraction:
    end = today + timedelta(days=source.horizon_days)
    records: list[RawRecord] = []
    for eclipse_type, moment in solar_eclipses(today, end):
        records.append(
            _record(
                source,
                name=f"{eclipse_type.capitalize()} solar eclipse",
                external_id=(
                    f"solar-eclipse-{eclipse_type}-{moment.date().isoformat()}"
                ),
                moment=moment,
                description=(
                    f"Global {eclipse_type} solar eclipse; greatest eclipse at "
                    f"{moment.time().strftime('%H:%M')} UTC. Computed with Swiss "
                    "Ephemeris (Moshier)."
                ),
            )
        )
    for eclipse_type, moment in lunar_eclipses(today, end):
        records.append(
            _record(
                source,
                name=f"{eclipse_type.capitalize()} lunar eclipse",
                external_id=(
                    f"lunar-eclipse-{eclipse_type}-{moment.date().isoformat()}"
                ),
                moment=moment,
                description=(
                    f"Global {eclipse_type} lunar eclipse; greatest eclipse at "
                    f"{moment.time().strftime('%H:%M')} UTC. Computed with Swiss "
                    "Ephemeris (Moshier)."
                ),
            )
        )

    season_longitudes = {
        "equinox-march": "0°",
        "solstice-june": "90°",
        "equinox-september": "180°",
        "solstice-december": "270°",
    }
    for name, stem, moment in seasonal_events(today, end):
        records.append(
            _record(
                source,
                name=name,
                external_id=f"{stem}-{moment.year}",
                moment=moment,
                description=(
                    f"The Sun reaches {season_longitudes[stem]} apparent geocentric "
                    f"ecliptic longitude ({name}) at {moment.time().strftime('%H:%M')} "
                    "UTC. Computed with Swiss Ephemeris (Moshier)."
                ),
            )
        )

    records.sort(key=lambda record: (record.start_date, record.start_time or ""))
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
