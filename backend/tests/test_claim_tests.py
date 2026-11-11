"""Tests for backend/scripts/build_claim_tests.py.

The pure statistics and windowing run everywhere. The astronomy check needs a
Skyfield ephemeris: it uses SKYFIELD_EPHEMERIS when set, otherwise the repo's
committed data/raw/de421.bsp (1900-2050), so it runs in CI without a download.
"""

from __future__ import annotations

import importlib.util
import os
from datetime import datetime, timezone
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
