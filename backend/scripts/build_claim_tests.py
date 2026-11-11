"""Build the three claim-tested explainer datasets ahead of request time.

Run from the backend directory with its astronomy dependencies available:

    python scripts/build_claim_tests.py

Skyfield downloads de406.bsp on first use (or set SKYFIELD_EPHEMERIS to a local
file). The market record and the decline list are the repo's existing artifacts.

Method summary (also written into each JSON):

* The repo's S&P series (sp500_proxy) runs 1871-2026. It is monthly before
  1927-12-30 (NBER M1125AUSM343NNBR) and daily from 1927-12-30 (Yahoo GSPC).
* The headline test uses the daily part, because a seven-day window needs daily
  observations. That boundary is the data's own resolution change, not a chosen
  start year.
* A full-history monthly test runs the same comparison at monthly resolution
  over 1871-2026 so the whole record is covered.
"""

from __future__ import annotations

import json
import math
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

BACKEND_DIR = Path(__file__).resolve().parents[1]
REPO_DIR = BACKEND_DIR.parent
ARTIFACT = BACKEND_DIR / "data" / "processed" / "macro_regime_history.parquet"
META = BACKEND_DIR / "data" / "processed" / "macro_regime_history.meta.json"
OUTPUT = REPO_DIR / "frontend" / "content" / "tested"
SEED = 20_261_111
PERMUTATIONS = 2_000
MEANINGFUL_MEAN_DIFFERENCE = 0.005  # half a percentage point
FULL_MOON_DAYS = 7
ECLIPSE_DAYS = 7
EARTH_RADIUS_KM = 6_378.137
DAILY_SOURCE = "YAHOO_FINANCE_GSPC"

CLAIMS = {
    "mercury-retrograde": {
        "title": "Mercury retrograde and the market",
        "claim": "Mercury retrograde is often said to unsettle the market.",
        "windows": "Every Mercury retrograde station-to-station window in the record, with no exclusions by year or outcome.",
    },
    "full-moon": {
        "title": "The full moon and the market",
        "claim": "A full moon is often said to change how the market behaves.",
        "windows": "Every full moon in the record, using the seven calendar days from three days before to three days after it.",
    },
    "eclipses": {
        "title": "Eclipses and the market",
        "claim": "Eclipses are often said to mark turning points in the market.",
        "windows": "Every solar eclipse visible anywhere on Earth (partial, annular or total) and every lunar eclipse (penumbral, partial or total) in the record, using the seven calendar days from three days before to three days after it.",
    },
}


def iso_day(value: datetime) -> str:
    return value.date().isoformat()


def event_json(start: datetime, end: datetime, kind: str) -> dict[str, Any]:
    return {
        "start": iso_day(start),
        "end": iso_day(end),
        "kind": kind,
        "start_utc": start.isoformat().replace("+00:00", "Z"),
        "end_utc": end.isoformat().replace("+00:00", "Z"),
    }


def astronomy_windows(start_year: int, end_year: int, after: datetime) -> dict[str, Any]:
    from skyfield import almanac
    from skyfield.api import load
    from skyfield.eclipselib import angle_between, lunar_eclipses
    from skyfield.searchlib import find_minima

    ephemeris = os.environ.get("SKYFIELD_EPHEMERIS", "de406.bsp")
    eph = load(ephemeris)
    ts = load.timescale()
    earth = eph["earth"]
    mercury = eph["mercury"]
    start = ts.utc(start_year, 1, 1)
    # One extra year is read only so the page can link the next event.
    end = ts.utc(end_year + 2, 1, 1)

    # Mercury: apparent geocentric ecliptic longitude, sampled daily, then
    # bisected to the minute at each station.
    times = ts.tt_jd(np.arange(start.tt, end.tt, 1.0))
    longitudes = earth.at(times).observe(mercury).apparent().ecliptic_latlon()[1].degrees
    motion = (np.diff(longitudes) + 180.0) % 360.0 - 180.0
    sign = np.sign(motion)

    def longitude_at(julian: float) -> float:
        time = ts.tt_jd(julian)
        return float(earth.at(time).observe(mercury).apparent().ecliptic_latlon()[1].degrees)

    stations: list[dict[str, Any]] = []
    for index in np.where(np.diff(sign) != 0)[0] + 1:
        before = float(times[index - 1].tt)
        right_jd = float(times[index].tt)
        before_sign = float(sign[index - 1])
        for _ in range(26):
            middle = (before + right_jd) / 2.0
            change = (longitude_at(middle) - longitude_at(before) + 180.0) % 360.0 - 180.0
            if np.sign(change) == before_sign or change == 0:
                before = middle
            else:
                right_jd = middle
        stations.append(
            {
                "date": ts.tt_jd((before + right_jd) / 2.0).utc_datetime(),
                "kind": "retrograde" if before_sign > 0 else "direct",
            }
        )

    mercury_windows = []
    for left, right in zip(stations, stations[1:]):
        if left["kind"] == "retrograde" and right["kind"] == "direct":
            mercury_windows.append(event_json(left["date"], right["date"], "mercury_retrograde"))
    next_mercury = next(
        (s for s in stations if s["kind"] == "retrograde" and s["date"] > after), None
    )

    # Full moons: the exact phase time, tested with a fixed seven-day window.
    phase_times, phases = almanac.find_discrete(start, end, almanac.moon_phases(eph))
    full_moons = []
    for time, phase in zip(phase_times, phases):
        if int(phase) != 2:
            continue
        moment = time.utc_datetime()
        full_moons.append(
            event_json(
                moment - timedelta(days=FULL_MOON_DAYS // 2),
                moment + timedelta(days=FULL_MOON_DAYS // 2),
                "full_moon",
            )
        )
    next_full_moon = next(
        (
            time.utc_datetime()
            for time, phase in zip(phase_times, phases)
            if int(phase) == 2 and time.utc_datetime() > after
        ),
        None,
    )

    # Lunar eclipses: Skyfield's eclipse geometry. Codes are the library's
    # 0 penumbral, 1 partial, 2 total.
    lunar_times, lunar_codes, _ = lunar_eclipses(start, end, eph)
    lunar_labels = {0: "lunar_penumbral", 1: "lunar_partial", 2: "lunar_total"}
    eclipses = []
    for time, code in zip(lunar_times, lunar_codes):
        moment = time.utc_datetime()
        eclipses.append(
            event_json(
                moment - timedelta(days=ECLIPSE_DAYS // 2),
                moment + timedelta(days=ECLIPSE_DAYS // 2),
                lunar_labels.get(int(code), "lunar"),
            )
        )

    # Solar eclipses: every new-moon minimum of the Sun/Moon separation where
    # the two apparent discs overlap. Labelled simply "solar": central or
    # partial depends on the observer's location.
    segments = {(s.center, s.target): s.spk_segment for s in eph.segments}

    def separation(time):
        jd, fraction = time.whole, time.tdb_fraction
        barycenter = segments[0, 3].compute(jd, fraction)
        earth_position = segments[3, 399].compute(jd, fraction)
        moon_position = segments[3, 301].compute(jd, fraction)
        sun_position = segments[0, 10].compute(jd, fraction)
        return angle_between(
            sun_position - barycenter - earth_position, moon_position - earth_position
        )

    separation.step_days = 3.0
    minima, _ = find_minima(start, end, separation, num=12)
    for time in minima:
        jd, fraction = time.whole, time.tdb_fraction
        barycenter = segments[0, 3].compute(jd, fraction)
        earth_position = segments[3, 399].compute(jd, fraction)
        moon_position = segments[3, 301].compute(jd, fraction)
        sun_position = segments[0, 10].compute(jd, fraction)
        sun_distance = np.linalg.norm(sun_position - barycenter - earth_position)
        moon_distance = np.linalg.norm(moon_position - earth_position)
        separation_degrees = float(separation(time) * 180.0 / np.pi)
        sun_radius = math.degrees(math.asin(696_340.0 / sun_distance))
        moon_radius = math.degrees(math.asin(1_737.1 / moon_distance))
        # An eclipse is visible somewhere on Earth when the discs overlap from
        # some point on its surface, not just from its centre: widen the limit
        # by the Moon's horizontal parallax minus the Sun's.
        moon_parallax = math.degrees(math.asin(EARTH_RADIUS_KM / moon_distance))
        sun_parallax = math.degrees(math.asin(EARTH_RADIUS_KM / sun_distance))
        limit = sun_radius + moon_radius + moon_parallax - sun_parallax
        if separation_degrees >= limit:
            continue
        moment = time.utc_datetime()
        eclipses.append(
            event_json(
                moment - timedelta(days=ECLIPSE_DAYS // 2),
                moment + timedelta(days=ECLIPSE_DAYS // 2),
                "solar",
            )
        )
    eclipses.sort(key=lambda window: window["start_utc"])
    next_eclipse = next(
        (
            window
            for window in eclipses
            if datetime.fromisoformat(window["start_utc"].replace("Z", "+00:00"))
            + timedelta(days=ECLIPSE_DAYS // 2)
            > after
        ),
        None,
    )
    return {
        "mercury": mercury_windows,
        "full_moon": full_moons,
        "eclipses": eclipses,
        "next": {
            "mercury": next_mercury,
            "full_moon": next_full_moon,
            "eclipses": next_eclipse,
        },
    }


def overlaps(left: dict[str, Any], right: dict[str, Any]) -> bool:
    return left["start"] <= right["end"] and right["start"] <= left["end"]


def daily_window_return(frame: pd.DataFrame, start: str, end: str) -> dict[str, Any] | None:
    subset = frame.loc[(frame.index >= start) & (frame.index <= end), "sp500_proxy"].dropna()
    if len(subset) < 2:
        return None
    first = float(subset.iloc[0])
    last = float(subset.iloc[-1])
    if first <= 0:
        return None
    return {"start": start, "end": end, "return": last / first - 1.0, "sessions": int(len(subset))}


def permutation_test(in_returns: list[float], out_returns: list[float]) -> tuple[float, float]:
    observed = float(np.mean(in_returns) - np.mean(out_returns))
    rng = np.random.default_rng(SEED)
    combined = np.asarray(in_returns + out_returns)
    count = len(in_returns)
    extreme = 0
    for _ in range(PERMUTATIONS):
        shuffled = rng.permutation(combined)
        difference = float(np.mean(shuffled[:count]) - np.mean(shuffled[count:]))
        extreme += int(abs(difference) >= abs(observed))
    return observed, (extreme + 1) / (PERMUTATIONS + 1)


def summarise(
    in_returns: list[float],
    out_returns: list[float],
    in_declines: int,
    out_declines: int,
) -> dict[str, Any]:
    observed, p_value = permutation_test(in_returns, out_returns)
    meaningful = p_value < 0.05 and abs(observed) >= MEANINGFUL_MEAN_DIFFERENCE
    return {
        "in": {
            "n": len(in_returns),
            "mean_return": float(np.mean(in_returns)),
            "median_return": float(np.median(in_returns)),
            "decline_starts": in_declines,
            "decline_share": in_declines / len(in_returns),
        },
        "out": {
            "n": len(out_returns),
            "mean_return": float(np.mean(out_returns)),
            "median_return": float(np.median(out_returns)),
            "decline_starts": out_declines,
            "decline_share": out_declines / len(out_returns),
        },
        "mean_difference": observed,
        "median_difference": float(np.median(in_returns) - np.median(out_returns)),
        "p_value": p_value,
        "permutations": PERMUTATIONS,
        "seed": SEED,
        "meaningful": bool(meaningful),
    }


def build_daily_comparison(
    events: list[dict[str, Any]],
    frame: pd.DataFrame,
    decline_peaks: list[str],
) -> dict[str, Any]:
    events = sorted(events, key=lambda event: event["start"])
    used_controls: list[dict[str, Any]] = []
    in_returns: list[float] = []
    out_returns: list[float] = []
    in_declines = 0
    out_declines = 0
    windows: list[dict[str, Any]] = []

    def has_decline(start: str, end: str) -> bool:
        return any(start <= peak <= end for peak in decline_peaks)

    def control_for(event: dict[str, Any]) -> dict[str, Any] | None:
        start = datetime.fromisoformat(event["start"])
        end = datetime.fromisoformat(event["end"])
        duration = (end - start).days
        for direction in (-1, 1):
            candidate_end = (
                start - timedelta(days=1)
                if direction < 0
                else end + timedelta(days=duration + 1)
            )
            for _ in range(900):
                candidate_start = candidate_end - timedelta(days=duration)
                candidate = {"start": iso_day(candidate_start), "end": iso_day(candidate_end)}
                measured = daily_window_return(frame, candidate["start"], candidate["end"])
                collision = any(overlaps(candidate, item) for item in events) or any(
                    overlaps(candidate, item) for item in used_controls
                )
                if measured and not collision:
                    return {**candidate, **measured}
                candidate_end = candidate_end + timedelta(days=(duration + 1) * direction)
                if candidate_end.year < frame.index[0].year or candidate_end.year > frame.index[-1].year + 1:
                    break
        return None

    for event in events:
        measured = daily_window_return(frame, event["start"], event["end"])
        control = control_for(event)
        if not measured or not control:
            continue
        in_returns.append(measured["return"])
        out_returns.append(control["return"])
        in_declines += int(has_decline(event["start"], event["end"]))
        out_declines += int(has_decline(control["start"], control["end"]))
        used_controls.append(control)
        windows.append(
            {
                "start": event["start"],
                "end": event["end"],
                "kind": event["kind"],
                "return": round(measured["return"], 6),
                "decline_start": has_decline(event["start"], event["end"]),
            }
        )
    if not in_returns:
        raise ValueError("No event windows had both an in-window and a control return")
    summary = summarise(in_returns, out_returns, in_declines, out_declines)
    summary["windows"] = windows
    return summary


def month_of(date_string: str) -> pd.Timestamp:
    return pd.Timestamp(date_string).to_period("M").to_timestamp("M")


def month_bounds(period: pd.Timestamp) -> tuple[str, str]:
    return (
        (period - pd.offsets.MonthBegin(1)).date().isoformat(),
        period.date().isoformat(),
    )


def build_monthly_comparison(
    events: list[dict[str, Any]],
    monthly: pd.Series,
) -> dict[str, Any]:
    """The same question at monthly resolution over the whole record.

    A month counts as in-window when it contains an event, and the whole
    comparison is against every other month. This is unpaired, so it works
    wherever an out-of-window set exists at all. A full moon falls in almost
    every month, so that claim has no out-of-window set here and is reported as
    not separable at monthly resolution.
    """
    returns = monthly.pct_change().dropna()

    def midpoint_month(event: dict[str, Any]) -> pd.Timestamp:
        start = pd.Timestamp(event["start"])
        end = pd.Timestamp(event["end"])
        middle = start + (end - start) / 2
        return middle.to_period("M").to_timestamp("M")

    event_months = {midpoint_month(event) for event in events}
    in_months = [period for period in returns.index if period in event_months]
    out_months = [period for period in returns.index if period not in event_months]
    if len(out_months) < 30:
        return {
            "available": False,
            "reason": (
                "Every month in the record contains an event of this kind, so there "
                "is no month outside the window. Only the daily test separates them."
            ),
            "in_months": len(in_months),
            "out_months": len(out_months),
        }
    in_returns = [float(returns[period]) for period in in_months]
    out_returns = [float(returns[period]) for period in out_months]
    in_declines = sum(
        1
        for period in in_months
        if any(month_bounds(period)[0] <= peak <= month_bounds(period)[1] for peak in DECLINE_PEAKS)
    )
    out_declines = sum(
        1
        for period in out_months
        if any(month_bounds(period)[0] <= peak <= month_bounds(period)[1] for peak in DECLINE_PEAKS)
    )
    summary = summarise(in_returns, out_returns, in_declines, out_declines)
    summary["available"] = True
    return summary


def yearly_chart(windows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_year: dict[int, list[float]] = {}
    for window in windows:
        by_year.setdefault(int(window["start"][:4]), []).append(window["return"])
    return [
        {"year": year, "value": round(float(np.mean(values)) * 100.0, 4)}
        for year, values in sorted(by_year.items())
    ]


def result_text(comparison: dict[str, Any]) -> tuple[str, str]:
    if not comparison["meaningful"]:
        return "No meaningful difference in this record.", "no_meaningful_difference"
    inside = comparison["in"]["mean_return"] * 100.0
    outside = comparison["out"]["mean_return"] * 100.0
    difference = comparison["mean_difference"] * 100.0
    return (
        f"The in-window mean return was {inside:+.2f}% against {outside:+.2f}% outside, "
        f"a difference of {difference:+.2f} points (permutation p={comparison['p_value']:.4f}).",
        "different",
    )


def next_event_json(value: Any) -> Any:
    if isinstance(value, datetime):
        return {"date": value.isoformat().replace("+00:00", "Z")}
    if isinstance(value, dict) and isinstance(value.get("date"), datetime):
        return {**value, "date": value["date"].isoformat().replace("+00:00", "Z")}
    return value


DECLINE_PEAKS: list[str] = []


def build_claim(
    claim: str,
    events: list[dict[str, Any]],
    daily: pd.DataFrame,
    monthly: pd.Series,
    meta: dict[str, Any],
    next_event: Any,
    daily_start: str,
) -> dict[str, Any]:
    full = build_monthly_comparison(events, monthly)
    daily_events = [event for event in events if event["start"] >= daily_start]
    comparison = build_daily_comparison(daily_events, daily, DECLINE_PEAKS)
    result, result_code = result_text(comparison)
    daily_first = daily["sp500_proxy"].dropna().index[0].date().isoformat()
    daily_last = daily["sp500_proxy"].dropna().index[-1].date().isoformat()
    config = CLAIMS[claim]
    return {
        "id": claim,
        "title": config["title"],
        "claim": config["claim"],
        "result": result,
        "result_code": result_code,
        "series": {
            "name": "S&P 500 / Cowles chained proxy (sp500_proxy)",
            "column": "sp500_proxy",
            "frequency": "daily",
            "start": daily_first,
            "end": daily_last,
            "years": f"{daily_first[:4]}\u2013{daily_last[:4]}",
            "full_record": {
                "start": "1871-01-01",
                "end": daily_last,
                "years": f"1871\u2013{daily_last[:4]}",
                "monthly_before": daily_start,
            },
        },
        "source": {
            "artifact": "backend/data/processed/macro_regime_history.parquet",
            "meta": "backend/data/processed/macro_regime_history.meta.json",
            "market": "sp500_proxy: NBER M1125AUSM343NNBR (monthly) before "
            f"{daily_start}, Yahoo GSPC (daily) from {daily_start}",
            "astronomy": "Skyfield with the DE406 ephemeris",
            "build_date": datetime.now(timezone.utc).date().isoformat(),
            "data_version": meta.get("data_version"),
        },
        "comparison": {key: value for key, value in comparison.items() if key != "windows"},
        "full_history": {key: value for key, value in full.items() if key != "windows"},
        "chart": yearly_chart(comparison["windows"]),
        "windows": comparison["windows"],
        "next_event": next_event_json(next_event),
        "method": [
            config["windows"],
            "Returns are the S&P proxy close at the first session in a window to its close at the last session in that window.",
            "Each event window is paired with the nearest non-overlapping window of the same calendar length, searching backward first, then forward. Control windows never overlap an event or another control.",
            "Decline starts are peaks in the repo's /declines list of falls of 20% or more; a window counts if a peak falls inside it, inclusive of both ends.",
            f"The uncertainty check is a two-sided permutation test of the mean-return difference, {PERMUTATIONS} shuffles with seed {SEED}.",
            "A difference is called meaningful only when p < 0.05 and the mean-return difference is at least 0.5 percentage points in absolute size.",
            "The p-value and the sample sizes are reported exactly as computed; the same seed reproduces the same result.",
        ],
        "limitations": [
            "This is a descriptive comparison of a historical record, not evidence of a cause and not a forecast.",
            "The daily S&P record starts 30 Dec 1927 (Yahoo GSPC). Before that the repo's proxy is monthly (NBER, 1871-1926), so short-window returns there would be mostly forward-filled; the headline test uses the daily record and the full-history test uses monthly returns.",
            "The early S&P series is a chained Cowles/S&P proxy, and daily sessions before 1957 do not match the modern S&P 500 exactly.",
            "Control windows follow a fixed rule, but seasonality, volatility clustering and overlapping macro events remain in the record.",
            "Permutation p-values measure how unusual the mean difference is under relabelling; they do not remove those dependencies.",
            "Decline starts are only the falls in the current /declines list, not every possible market fall.",
        ],
    }


def main() -> None:
    global DECLINE_PEAKS
    raw = pd.read_parquet(ARTIFACT)
    raw.index = pd.to_datetime(raw.index, utc=True)
    raw = raw.sort_index()
    frame = raw[["sp500_proxy", "sp500_proxy_source"]].dropna(subset=["sp500_proxy"])
    daily_rows = frame[frame["sp500_proxy_source"] == DAILY_SOURCE]
    daily_start = daily_rows.index[0].date().isoformat()
    daily = frame[frame.index >= daily_start][["sp500_proxy"]]
    monthly = frame["sp500_proxy"].resample("ME").last().dropna()
    if monthly.index.tz is not None:
        monthly.index = monthly.index.tz_localize(None)

    meta = json.loads(META.read_text(encoding="utf-8"))
    falls = (
        meta.get("core_index", {})
        .get("trend_warning", {})
        .get("record", {})
        .get("falls_of_20pct_or_more", {})
        .get("falls", [])
    )
    DECLINE_PEAKS = [fall["peak"] for fall in falls if fall.get("peak")]

    astronomy = astronomy_windows(
        int(frame.index[0].year),
        int(daily.index[-1].year),
        pd.Timestamp(daily.index[-1]).to_pydatetime(),
    )
    OUTPUT.mkdir(parents=True, exist_ok=True)
    for claim, key in (
        ("mercury-retrograde", "mercury"),
        ("full-moon", "full_moon"),
        ("eclipses", "eclipses"),
    ):
        payload = build_claim(
            claim,
            astronomy[key],
            daily,
            monthly,
            meta,
            astronomy["next"][key],
            daily_start,
        )
        path = OUTPUT / f"{claim}.json"
        path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        full = payload["full_history"]
        monthly_note = (
            f"monthly n={full['in']['n']} p={round(full['p_value'], 4)}"
            if full.get("available")
            else "monthly not separable"
        )
        print(
            path,
            "daily n=", payload["comparison"]["in"]["n"],
            "p=", round(payload["comparison"]["p_value"], 4),
            "|", monthly_note,
            "|", payload["result"],
        )


if __name__ == "__main__":
    main()
