from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from regime.analytics import (  # noqa: E402
    annotate_nber,
    build_crashes,
    build_sp500_proxy,
    calculate_macro_strength,
    calculate_macro_strength_components,
    nber_episodes,
)
from scripts.flows.macro_ingestion import (  # noqa: E402
    SERIES_REGISTRY,
    MacroConfigError,
    build_macro_frame,
    parse_fred_observations,
    select_specs,
)


def test_registry_has_60_plus_unique_series():
    ids = [spec.series_id for spec in SERIES_REGISTRY]
    assert len(ids) >= 60
    assert len(ids) == len(set(ids))
    assert {"USREC", "T10Y2Y", "FEDFUNDS", "CPIAUCSL", "PPIACO"} <= set(ids)


def test_select_specs_accepts_case_insensitive_ids():
    specs = select_specs("usrec,t10y2y")
    assert [spec.series_id for spec in specs] == ["USREC", "T10Y2Y"]
    with pytest.raises(MacroConfigError):
        select_specs("USREC,NOT_A_SERIES")


def test_parse_fred_observations_skips_missing_values():
    payload = {
        "observations": [
            {"date": "2020-01-01", "value": "1.5"},
            {"date": "2020-01-02", "value": "."},
            {"date": "2020-01-03", "value": "2"},
            {"date": "2020-01-04", "value": None},
        ]
    }
    series = parse_fred_observations(payload, "TEST")
    assert len(series) == 2
    assert series.name == "TEST"
    assert series.iloc[0] == 1.5
    assert series.index.tz is not None


def test_build_macro_frame_forward_fills_without_backfill():
    daily_index = pd.to_datetime(
        ["2020-01-01", "2020-01-03"], utc=True
    )
    monthly_index = pd.to_datetime(
        ["2020-01-01", "2020-02-01"], utc=True
    )
    daily = pd.Series([1.0, 3.0], index=daily_index, name="D")
    monthly = pd.Series([10.0, 20.0], index=monthly_index, name="M")

    frame = build_macro_frame(
        {"D": daily, "M": monthly},
        start="2019-12-30",
        end="2020-02-02",
    )

    assert frame.index.tz is not None
    assert frame.index.name == "date"
    assert pd.isna(frame.loc["2019-12-31", "M"])
    assert frame.loc["2020-01-02", "M"] == 10.0
    assert frame.loc["2020-01-02", "D"] == 1.0
    assert frame.loc["2020-02-01", "M"] == 20.0


def _nber_frame() -> pd.DataFrame:
    index = pd.date_range("2019-01-01", "2020-06-30", freq="D", tz="UTC")
    usrec = pd.Series(0.0, index=index, name="USREC")
    usrec.loc["2020-03-01":"2020-04-30"] = 1.0
    frame = annotate_nber(pd.DataFrame({"USREC": usrec}))
    frame["T10Y2Y"] = 0.5
    frame["FEDFUNDS"] = 2.0
    frame["macro_strength"] = 50.0
    frame["sp500_proxy"] = 3000.0
    return frame


def test_nber_alignment_and_episode_boundaries():
    frame = _nber_frame()

    assert frame.loc["2020-01-15", "nber_phase"] == "expansion"
    assert frame.loc["2020-03-15", "nber_phase"] == "recession"
    assert bool(frame.loc["2020-03-01", "nber_recession_start"])
    assert bool(frame.loc["2020-05-01", "nber_recession_end"])
    assert frame.loc["2020-03-15", "nber_episode"] == 1
    assert frame.loc["2020-01-15", "nber_episode"] == 0

    episodes = nber_episodes(frame)
    assert len(episodes) == 1
    assert episodes[0]["start"] == "2020-02-01"
    assert episodes[0]["end"] == "2020-04-30"
    assert episodes[0]["indicator_start"] == "2020-03-01"
    assert episodes[0]["indicator_end"] == "2020-04-30"
    assert episodes[0]["duration_days"] == 90
    assert episodes[0]["name"] == "COVID-19 shock"


def test_crash_objects_include_3m_and_6m_pre_crash_state():
    crashes = build_crashes(_nber_frame())
    assert len(crashes) == 1
    crash = crashes[0]
    assert crash["start"] == "2020-02-01"
    assert crash["zoom_window"]["start"] == "2019-08-01"
    three = crash["pre_crash_indicators"]["3m"]
    six = crash["pre_crash_indicators"]["6m"]
    assert three["as_of"] == "2019-11-01"
    assert six["as_of"] == "2019-08-01"
    assert three["t10y2y"] == 0.5
    assert three["fed_funds"] == 2.0
    assert three["curve_inverted"] is False
    assert three["phase"] == "expansion"


def test_strength_is_bounded_and_responds_to_fed_trend():
    index = pd.date_range("2010-01-01", periods=2500, freq="D", tz="UTC")
    curve = pd.Series(0.0, index=index, name="T10Y2Y")
    fed_up = pd.Series(np.linspace(0.0, 5.0, len(index)), index=index, name="FEDFUNDS")
    fed_down = pd.Series(np.linspace(5.0, 0.0, len(index)), index=index, name="FEDFUNDS")

    score_up = calculate_macro_strength(
        pd.DataFrame({"T10Y2Y": curve, "FEDFUNDS": fed_up})
    )
    score_down = calculate_macro_strength(
        pd.DataFrame({"T10Y2Y": curve, "FEDFUNDS": fed_down})
    )

    assert np.isnan(score_up.iloc[0])
    assert score_up.dropna().between(0.0, 100.0).all()
    assert score_down.dropna().iloc[-1] > score_up.dropna().iloc[-1]


def test_strength_does_not_read_usrec():
    index = pd.date_range("2010-01-01", periods=1200, freq="D", tz="UTC")
    base = pd.DataFrame(
        {
            "FEDFUNDS": np.linspace(0.0, 3.0, len(index)),
            "T10Y2Y": np.linspace(-1.0, 2.0, len(index)),
        },
        index=index,
    )
    frame_a = base.assign(USREC=0.0)
    frame_b = base.assign(USREC=1.0)
    pd.testing.assert_series_equal(
        calculate_macro_strength(frame_a),
        calculate_macro_strength(frame_b),
    )


def test_strength_partial_coverage_when_only_fed_is_available():
    index = pd.date_range("2010-01-01", periods=1200, freq="D", tz="UTC")
    frame = pd.DataFrame(
        {"FEDFUNDS": np.linspace(0.0, 3.0, len(index))}, index=index
    )
    components = calculate_macro_strength_components(frame)
    assert components["macro_strength_coverage"].max() == pytest.approx(0.55)
    assert components["macro_strength"].notna().any()


def test_sp500_proxy_priority_and_source_labels():
    index = pd.date_range("2020-01-01", periods=3, freq="D", tz="UTC")
    frame = pd.DataFrame(
        {
            "M1125AUSM343NNBR": [100.0, np.nan, np.nan],
            "M1109BUSM293NNBR": [90.0, 200.0, np.nan],
            "SP500": [np.nan, 300.0, 400.0],
            "NASDAQCOM": [np.nan, 250.0, 350.0],
        },
        index=index,
    )
    proxy = build_sp500_proxy(frame)
    assert proxy["sp500_proxy"].tolist() == [100.0, 200.0, 400.0]
    assert proxy["sp500_proxy_source"].tolist() == [
        "M1125AUSM343NNBR",
        "M1109BUSM293NNBR",
        "SP500",
    ]


def test_sp500_proxy_respects_raw_source_boundaries():
    index = pd.date_range("2020-01-01", periods=4, freq="D", tz="UTC")
    frame = pd.DataFrame(index=index)
    raw = pd.DataFrame(
        {
            "M1125AUSM343NNBR": [100.0, np.nan, np.nan, np.nan],
            "M1109BUSM293NNBR": [np.nan, 200.0, np.nan, np.nan],
            "SP500": [np.nan, np.nan, np.nan, 400.0],
            "NASDAQCOM": [np.nan, np.nan, 350.0, np.nan],
        },
        index=index,
    )
    proxy = build_sp500_proxy(frame, raw_frame=raw)
    assert proxy["sp500_proxy"].tolist() == [100.0, 200.0, 350.0, 400.0]
    assert proxy["sp500_proxy_source"].tolist() == [
        "M1125AUSM343NNBR",
        "M1109BUSM293NNBR",
        "NASDAQCOM",
        "SP500",
    ]
