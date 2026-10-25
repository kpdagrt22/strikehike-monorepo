#!/usr/bin/env python3
"""Generate the 1900-2035 sidereal ephemeris knots used by the chrono backend.

The format matches the existing StrikeHike ephemeris:
  start, stepDays, dates, fast, slowStepDays, slow

Bodies: Sun, Mercury, Venus, Mars (10-day knots);
        Jupiter, Saturn, Rahu, Ketu (30-day knots).

Swiss Ephemeris 2.10, Lahiri sidereal. Rahu is the mean node; Ketu is Rahu + 180.
"""

from __future__ import annotations

import json
from datetime import date, timedelta
from pathlib import Path

import swisseph as swe

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "src" / "data" / "astro" / "ephemeris.json"

START = date(1900, 1, 1)
END = date(2035, 12, 31)
FAST_STEP = 10
SLOW_STEP = 30

FAST = {
    "Sun": swe.SUN,
    "Mercury": swe.MERCURY,
    "Venus": swe.VENUS,
    "Mars": swe.MARS,
}
SLOW = {
    "Jupiter": swe.JUPITER,
    "Saturn": swe.SATURN,
    "Rahu": swe.MEAN_NODE,
    "Ketu": swe.MEAN_NODE,
}

FLAGS = swe.FLG_SWIEPH | swe.FLG_SIDEREAL | swe.FLG_SPEED


def longitude(jd: float, body: int, ketu: bool = False) -> float:
    values, _ = swe.calc_ut(jd, body, FLAGS)
    lon = values[0]
    if ketu:
        lon = (lon + 180.0) % 360.0
    return round(lon, 2)


def date_range(step_days: int) -> list[date]:
    days: list[date] = []
    current = START
    while current <= END:
        days.append(current)
        current += timedelta(days=step_days)
    return days


def main() -> None:
    swe.set_sid_mode(swe.SIDM_LAHIRI)

    fast_dates = date_range(FAST_STEP)
    slow_dates = date_range(SLOW_STEP)

    fast = {
        name: [longitude(swe.julday(d.year, d.month, d.day, 0.0), body) for d in fast_dates]
        for name, body in FAST.items()
    }

    slow: dict[str, list[float]] = {}
    for name, body in SLOW.items():
        slow[name] = [
            longitude(swe.julday(d.year, d.month, d.day, 0.0), body, ketu=(name == "Ketu"))
            for d in slow_dates
        ]

    payload = {
        "start": START.isoformat(),
        "stepDays": FAST_STEP,
        "dates": [d.isoformat() for d in fast_dates],
        "fast": fast,
        "slowStepDays": SLOW_STEP,
        "slow": slow,
        "source": "Swiss Ephemeris 2.10.03, Lahiri sidereal",
        "generated": date.today().isoformat(),
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")

    print(f"wrote {OUT}")
    print(f"fast knots: {len(fast_dates)}; slow knots: {len(slow_dates)}")
    print(f"size: {OUT.stat().st_size / 1024:.1f} KiB")


if __name__ == "__main__":
    main()
