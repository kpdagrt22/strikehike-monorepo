"""Tests for backend/scripts/build_claim_tests.py.

The pure statistics and windowing run everywhere. The astronomy check needs a
Skyfield ephemeris: it runs when SKYFIELD_EPHEMERIS points at a file, or when a
de406.bsp/de421.bsp sits in the backend directory, and skips otherwise so CI
never downloads hundreds of megabytes.
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
    candidates += [BACKEND / "de406.bsp", BACKEND / "de421.bsp"]
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
