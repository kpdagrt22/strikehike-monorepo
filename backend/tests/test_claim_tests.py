"""Tests for backend/scripts/build_claim_tests.py.

The pure statistics and windowing run everywhere. The astronomy check needs a
Skyfield ephemeris: it uses SKYFIELD_EPHEMERIS when set, otherwise the repo's
committed data/raw/de421.bsp (1900-2050), so it runs in CI without a download.
"""

from __future__ import annotations

import importlib.util
import os
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

BACKEND = Path(__file__).resolve().parents[1]
SCRIPT = BACKEND / "scripts" / "build_claim_tests.py"


def _load():
    spec = importlib.util.spec_from_file_location("build_claim_tests", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


builder = _load()


def test_permutation_test_is_stable_and_bounded():
    rng = np.random.default_rng(7)
    inside = list(rng.normal(0.01, 0.05, 50))
    outside = list(rng.normal(0.0, 0.05, 50))
    first = builder.permutation_test(inside, outside)
    second = builder.permutation_test(inside, outside)
    assert first == second  # the seed reproduces the result exactly
    observed, p_value = first
    assert observed == pytest.approx(float(np.mean(inside) - np.mean(outside)))
    assert 0.0 < p_value <= 1.0


def test_yearly_chart_averages_each_year():
    windows = [
        {"start": "2020-01-01", "return": 0.01},
        {"start": "2020-06-01", "return": 0.03},
        {"start": "2021-01-01", "return": -0.02},
    ]
    assert builder.yearly_chart(windows) == [
        {"year": 2020, "value": 2.0},
        {"year": 2021, "value": -2.0},
    ]


def test_summarise_flags_a_clear_difference():
    inside = [0.02 + 0.001 * (index % 5) for index in range(50)]
    outside = [-0.02 + 0.001 * (index % 5) for index in range(50)]
    summary = builder.summarise(inside, outside, 1, 0)
    assert summary["in"]["n"] == 50
    assert summary["out"]["n"] == 50
    assert summary["permutations"] == builder.PERMUTATIONS
    assert summary["seed"] == builder.SEED
    assert summary["meaningful"] is True
    text, code = builder.result_text(summary)
    assert code == "different"
    assert "difference" in text


def test_summarise_calls_a_null_result_no_difference():
    # The same multiset on both sides: no mean difference can survive.
    values = [(-0.01, 0.02)[index % 2] for index in range(60)]
    summary = builder.summarise(values, values[::-1], 0, 0)
    assert summary["meaningful"] is False
    text, code = builder.result_text(summary)
    assert code == "no_meaningful_difference"
    assert text == "No meaningful difference in this record."


def test_daily_comparison_pairs_controls_and_shapes_windows():
    index = pd.date_range("2024-01-01", periods=120, freq="D", tz="UTC")
    values = 100 * np.cumprod(
        1 + np.random.default_rng(3).normal(0, 0.005, len(index))
    )
    frame = pd.DataFrame({"sp500_proxy": values}, index=index)
    events = [
        builder.event_json(
            datetime(2024, 2, 1, tzinfo=timezone.utc),
            datetime(2024, 2, 7, tzinfo=timezone.utc),
            "full_moon",
        ),
        builder.event_json(
            datetime(2024, 3, 1, tzinfo=timezone.utc),
            datetime(2024, 3, 7, tzinfo=timezone.utc),
            "full_moon",
        ),
    ]
    summary = builder.build_daily_comparison(events, frame, [])
    assert summary["in"]["n"] == 2
    assert summary["out"]["n"] == 2
    assert len(summary["windows"]) == 2
    for window in summary["windows"]:
        assert set(window) == {"start", "end", "kind", "return", "decline_start"}
        assert window["kind"] == "full_moon"


def _ephemeris_or_skip() -> Path:
    pytest.importorskip("skyfield")
    candidates = []
    env = os.environ.get("SKYFIELD_EPHEMERIS")
    if env:
        candidates.append(Path(env))
    candidates += [
        BACKEND / "data" / "raw" / "de421.bsp",
        BACKEND / "de406.bsp",
        BACKEND / "de421.bsp",
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    pytest.skip("no Skyfield ephemeris (set SKYFIELD_EPHEMERIS or place de406.bsp)")


def test_known_astronomy_dates(monkeypatch):
    ephemeris = _ephemeris_or_skip()
    monkeypatch.setenv("SKYFIELD_EPHEMERIS", str(ephemeris))
    windows = builder.astronomy_windows(
        2024, 2024, datetime(2024, 1, 1, tzinfo=timezone.utc)
    )

    mercury = windows["mercury"]
    assert any(
        window["kind"] == "mercury_retrograde"
        and "2024-04-01" <= window["start"] <= "2024-04-03"
        for window in mercury
    ), "Mercury's April 2024 retrograde station is missing"

    eclipses = windows["eclipses"]
    assert any(
        window["kind"] == "solar" and window["start"] <= "2024-04-08" <= window["end"]
        for window in eclipses
    ), "the 8 April 2024 total solar eclipse is missing"

    assert windows["next"]["full_moon"] is not None
    assert windows["next"]["mercury"] is not None


def _solar_days(start_year: int, end_year: int) -> list[str]:
    """Calendar day of greatest eclipse (window centre) for each solar eclipse."""
    windows = builder.astronomy_windows(
        start_year, end_year, datetime(start_year, 1, 1, tzinfo=timezone.utc)
    )
    days = []
    for window in windows["eclipses"]:
        if window["kind"] != "solar":
            continue
        start = datetime.fromisoformat(window["start_utc"].replace("Z", "+00:00"))
        moment = start + pd.Timedelta(days=builder.ECLIPSE_DAYS // 2)
        if start_year <= moment.year <= end_year:
            days.append(moment.date().isoformat())
    return days


def test_solar_eclipse_counts_match_the_nasa_catalogue(monkeypatch):
    # NASA Five Millennium Canon of Solar Eclipses: 20 in 2001-2010 and 24 in
    # 2011-2020, partial eclipses included.
    ephemeris = _ephemeris_or_skip()
    monkeypatch.setenv("SKYFIELD_EPHEMERIS", str(ephemeris))
    assert len(_solar_days(2001, 2010)) == 20
    days_2011_2020 = _solar_days(2011, 2020)
    assert len(days_2011_2020) == 24
    in_2011 = [day for day in days_2011_2020 if day.startswith("2011")]
    assert in_2011 == ["2011-01-04", "2011-06-01", "2011-07-01", "2011-11-25"]

# References used by the P17 astronomy checks:
# * NASA GSFC, "Phases of the Moon: 2001 to 2100" (Universal Time):
#   https://eclipse.gsfc.nasa.gov/phase/phases2001.html
# * USNO, "Earth's Seasons" API (UTC):
#   https://aa.usno.navy.mil/api/seasons?year=YYYY
# * JPL Horizons, DE441 observer ephemeris, geocentric apparent ecliptic
#   longitude, daily samples 2000-2030:
#   https://ssd.jpl.nasa.gov/horizons/
NASA_NEW_MOONS = (
    "2001-01-24T13:07",
    "2005-04-08T20:32",
    "2010-01-15T07:11",
    "2011-12-24T18:06",
    "2015-03-20T09:36",
    "2016-03-09T01:54",
    "2020-06-21T06:41",
    "2024-04-08T18:21",
    "2025-01-29T12:36",
    "2026-08-12T17:37",
)

USNO_SEASONS = {
    2000: ((3, 20, "07:35"), (6, 21, "01:48"), (9, 22, "17:28"), (12, 21, "13:37")),
    2001: ((3, 20, "13:31"), (6, 21, "07:38"), (9, 22, "23:04"), (12, 21, "19:22")),
    2002: ((3, 20, "19:16"), (6, 21, "13:24"), (9, 23, "04:55"), (12, 22, "01:14")),
    2003: ((3, 21, "01:00"), (6, 21, "19:10"), (9, 23, "10:47"), (12, 22, "07:04")),
    2004: ((3, 20, "06:49"), (6, 21, "00:57"), (9, 22, "16:30"), (12, 21, "12:42")),
    2005: ((3, 20, "12:33"), (6, 21, "06:46"), (9, 22, "22:23"), (12, 21, "18:35")),
    2006: ((3, 20, "18:26"), (6, 21, "12:26"), (9, 23, "04:03"), (12, 22, "00:22")),
    2007: ((3, 21, "00:07"), (6, 21, "18:06"), (9, 23, "09:51"), (12, 22, "06:08")),
    2008: ((3, 20, "05:48"), (6, 20, "23:59"), (9, 22, "15:44"), (12, 21, "12:04")),
    2009: ((3, 20, "11:44"), (6, 21, "05:45"), (9, 22, "21:19"), (12, 21, "17:47")),
    2010: ((3, 20, "17:32"), (6, 21, "11:28"), (9, 23, "03:09"), (12, 21, "23:38")),
    2011: ((3, 20, "23:21"), (6, 21, "17:16"), (9, 23, "09:05"), (12, 22, "05:30")),
    2012: ((3, 20, "05:14"), (6, 20, "23:09"), (9, 22, "14:49"), (12, 21, "11:12")),
    2013: ((3, 20, "11:02"), (6, 21, "05:04"), (9, 22, "20:44"), (12, 21, "17:11")),
    2014: ((3, 20, "16:57"), (6, 21, "10:51"), (9, 23, "02:29"), (12, 21, "23:03")),
    2015: ((3, 20, "22:45"), (6, 21, "16:38"), (9, 23, "08:20"), (12, 22, "04:48")),
    2016: ((3, 20, "04:30"), (6, 20, "22:34"), (9, 22, "14:21"), (12, 21, "10:44")),
    2017: ((3, 20, "10:29"), (6, 21, "04:24"), (9, 22, "20:02"), (12, 21, "16:28")),
    2018: ((3, 20, "16:15"), (6, 21, "10:07"), (9, 23, "01:54"), (12, 21, "22:23")),
    2019: ((3, 20, "21:58"), (6, 21, "15:54"), (9, 23, "07:50"), (12, 22, "04:19")),
    2020: ((3, 20, "03:50"), (6, 20, "21:44"), (9, 22, "13:31"), (12, 21, "10:02")),
    2021: ((3, 20, "09:37"), (6, 21, "03:32"), (9, 22, "19:21"), (12, 21, "15:59")),
    2022: ((3, 20, "15:33"), (6, 21, "09:14"), (9, 23, "01:04"), (12, 21, "21:48")),
    2023: ((3, 20, "21:24"), (6, 21, "14:58"), (9, 23, "06:50"), (12, 22, "03:27")),
    2024: ((3, 20, "03:06"), (6, 20, "20:51"), (9, 22, "12:44"), (12, 21, "09:20")),
    2025: ((3, 20, "09:01"), (6, 21, "02:42"), (9, 22, "18:19"), (12, 21, "15:03")),
    2026: ((3, 20, "14:46"), (6, 21, "08:24"), (9, 23, "00:05"), (12, 21, "20:50")),
    2027: ((3, 20, "20:25"), (6, 21, "14:11"), (9, 23, "06:02"), (12, 22, "02:42")),
    2028: ((3, 20, "02:17"), (6, 20, "20:02"), (9, 22, "11:45"), (12, 21, "08:19")),
    2029: ((3, 20, "08:02"), (6, 21, "01:48"), (9, 22, "17:38"), (12, 21, "14:14")),
    2030: ((3, 20, "13:52"), (6, 21, "07:31"), (9, 22, "23:27"), (12, 21, "20:09")),
}

HORIZONS_MARS_STATIONS = (
    ("2001-05-11T04:06", "retrograde"),
    ("2001-07-19T10:45", "direct"),
    ("2003-07-28T19:36", "retrograde"),
    ("2003-09-26T19:51", "direct"),
    ("2005-10-01T10:02", "retrograde"),
    ("2005-12-09T16:06", "direct"),
    ("2007-11-14T20:23", "retrograde"),
    ("2008-01-30T10:36", "direct"),
    ("2009-12-20T01:25", "retrograde"),
    ("2010-03-10T05:10", "direct"),
    ("2012-01-23T12:51", "retrograde"),
    ("2012-04-13T15:55", "direct"),
    ("2014-03-01T04:22", "retrograde"),
    ("2014-05-19T13:33", "direct"),
    ("2016-04-17T00:13", "retrograde"),
    ("2016-06-29T11:38", "direct"),
    ("2018-06-26T09:03", "retrograde"),
    ("2018-08-27T02:05", "direct"),
    ("2020-09-09T10:21", "retrograde"),
    ("2020-11-13T12:36", "direct"),
    ("2022-10-30T01:25", "retrograde"),
    ("2023-01-12T08:58", "direct"),
    ("2024-12-06T11:31", "retrograde"),
    ("2025-02-23T14:02", "direct"),
    ("2027-01-10T00:58", "retrograde"),
    ("2027-04-01T02:09", "direct"),
    ("2029-02-13T20:14", "retrograde"),
    ("2029-05-05T07:01", "direct"),
)

HORIZONS_MARS_SATURN_CONJUNCTIONS = (
    "2000-04-15T20:27",
    "2002-05-04T05:58",
    "2004-05-25T05:39",
    "2006-06-18T06:04",
    "2008-07-10T18:11",
    "2010-07-31T08:07",
    "2012-08-15T10:35",
    "2014-08-25T19:29",
    "2016-08-24T11:25",
    "2018-04-02T15:44",
    "2020-03-31T18:30",
    "2022-04-05T01:51",
    "2024-04-10T20:36",
    "2026-04-19T22:43",
    "2028-04-30T22:40",
    "2030-05-16T13:57",
)


def _center(window: dict) -> datetime:
    return datetime.fromisoformat(window["start_utc"].replace("Z", "+00:00")) + timedelta(
        days=builder.FULL_MOON_DAYS // 2
    )


@pytest.fixture(scope="module")
def astronomy():
    ephemeris = _ephemeris_or_skip()
    previous = os.environ.get("SKYFIELD_EPHEMERIS")
    os.environ["SKYFIELD_EPHEMERIS"] = str(ephemeris)
    try:
        yield builder.astronomy_windows(
            1928, 2031, datetime(2031, 12, 31, tzinfo=timezone.utc)
        )
    finally:
        if previous is None:
            os.environ.pop("SKYFIELD_EPHEMERIS", None)
        else:
            os.environ["SKYFIELD_EPHEMERIS"] = previous


def test_new_moons_are_twelve_or_thirteen_each_year(astronomy):
    counts = Counter(
        _center(window).year
        for window in astronomy["new_moon"]
        if 1928 <= _center(window).year <= 2026
    )
    assert set(counts) == set(range(1928, 2027))
    assert all(count in (12, 13) for count in counts.values())


def test_new_moon_spot_checks_match_nasa(astronomy):
    centers = [_center(window) for window in astronomy["new_moon"]]
    for reference in NASA_NEW_MOONS:
        expected = datetime.fromisoformat(reference + ":00+00:00")
        nearest = min(centers, key=lambda value: abs(value - expected))
        assert abs(nearest - expected) <= timedelta(hours=1), reference


def test_seasons_match_usno_within_ten_minutes(astronomy):
    by_kind: dict[str, list[datetime]] = {}
    for window in astronomy["seasons"]:
        by_kind.setdefault(window["kind"], []).append(_center(window))
    labels = {
        3: "equinox_march",
        6: "solstice_june",
        9: "equinox_september",
        12: "solstice_december",
    }
    for year, entries in USNO_SEASONS.items():
        for month, day, clock in entries:
            hour, minute = (int(part) for part in clock.split(":"))
            expected = datetime(year, month, day, hour, minute, tzinfo=timezone.utc)
            kind = labels[month]
            nearest = min(by_kind[kind], key=lambda value: abs(value - expected))
            assert abs(nearest - expected) <= timedelta(minutes=10), (year, month)


def test_mars_stations_match_horizons_within_one_day(astronomy):
    stations: list[tuple[datetime, str]] = []
    for window in astronomy["mars_retrograde"]:
        start = datetime.fromisoformat(window["start_utc"].replace("Z", "+00:00"))
        end = datetime.fromisoformat(window["end_utc"].replace("Z", "+00:00"))
        if 2000 <= start.year <= 2030:
            stations.append((start, "retrograde"))
        if 2000 <= end.year <= 2030:
            stations.append((end, "direct"))
    assert len(stations) == len(HORIZONS_MARS_STATIONS)
    for reference, kind in HORIZONS_MARS_STATIONS:
        expected = datetime.fromisoformat(reference + ":00+00:00")
        nearest = min(
            (value for value, station_kind in stations if station_kind == kind),
            key=lambda value: abs(value - expected),
        )
        assert abs(nearest - expected) <= timedelta(days=1), reference


def test_mars_saturn_conjunctions_match_horizons_within_one_day(astronomy):
    centers = [
        _center(window)
        for window in astronomy["mars_saturn_conjunction"]
        if 2000 <= _center(window).year <= 2030
    ]
    assert len(centers) == len(HORIZONS_MARS_SATURN_CONJUNCTIONS)
    for reference in HORIZONS_MARS_SATURN_CONJUNCTIONS:
        expected = datetime.fromisoformat(reference + ":00+00:00")
        nearest = min(centers, key=lambda value: abs(value - expected))
        assert abs(nearest - expected) <= timedelta(days=1), reference


def test_non_overlapping_keeps_one_window_per_cluster():
    events = [
        builder.event_json(
            datetime(2024, 1, 1, tzinfo=timezone.utc),
            datetime(2024, 1, 7, tzinfo=timezone.utc),
            "new_moon",
        ),
        builder.event_json(
            datetime(2024, 1, 4, tzinfo=timezone.utc),
            datetime(2024, 1, 10, tzinfo=timezone.utc),
            "new_moon",
        ),
        builder.event_json(
            datetime(2024, 2, 1, tzinfo=timezone.utc),
            datetime(2024, 2, 7, tzinfo=timezone.utc),
            "new_moon",
        ),
    ]
    kept = builder.non_overlapping(events)
    assert len(kept) == 2
    assert kept[0]["start"] == "2024-01-01"
    assert kept[1]["start"] == "2024-02-01"


def test_build_claim_marks_fewer_than_thirty_windows_as_too_few():
    index = pd.date_range("2024-01-01", periods=120, freq="D", tz="UTC")
    values = 100 * np.cumprod(
        1 + np.random.default_rng(11).normal(0, 0.005, len(index))
    )
    daily = pd.DataFrame({"sp500_proxy": values}, index=index)
    monthly = daily["sp500_proxy"].resample("ME").last().dropna()
    monthly.index = monthly.index.tz_localize(None)
    events = [
        builder.event_json(
            datetime(2024, 2, 1, tzinfo=timezone.utc),
            datetime(2024, 2, 7, tzinfo=timezone.utc),
            "new_moon",
        )
    ]
    payload = builder.build_claim(
        "new-moon",
        events,
        daily,
        monthly,
        {"data_version": "test"},
        None,
        "2024-01-01",
    )
    assert payload["published"] is False
    assert payload["result"] == "Too few windows to test (1)"
    assert payload["too_few"] == {"windows": 1}
    assert payload["chart"] == []
    assert payload["windows"] == []
