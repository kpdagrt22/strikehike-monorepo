from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from regime.analytics import (  # noqa: E402
    STRENGTH_VERSION,
    STRENGTH_WEIGHTS,
    annotate_nber,
    build_crashes,
    build_sp500_proxy,
    calculate_core_index,
    calculate_macro_strength,
    calculate_macro_strength_components,
    nber_episodes,
)
from scripts.flows.macro_ingestion import (  # noqa: E402
    SERIES_REGISTRY,
    MacroConfigError,
    _parse_blockchain_bitcoin,
    build_asset_targets,
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


def test_nber_frame_starting_inside_recession_is_episode_one():
    index = pd.date_range("2020-03-01", "2020-04-30", freq="D", tz="UTC")
    usrec = pd.Series(1.0, index=index, name="USREC")
    frame = annotate_nber(pd.DataFrame({"USREC": usrec}))

    assert frame.iloc[0]["nber_episode"] == 1
    assert bool(frame.iloc[0]["nber_recession_start"])
    assert frame["nber_phase"].iloc[0] == "recession"


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
    assert components["macro_strength_coverage"].max() == pytest.approx(0.30)
    assert components["macro_strength"].notna().any()


def test_v2_weights_and_coverage_are_component_aware():
    assert STRENGTH_VERSION == "v2-zero-lag"
    assert STRENGTH_WEIGHTS == {
        "fed_score": 0.30,
        "curve_score": 0.30,
        "labor_score": 0.40,
    }

    index = pd.date_range("2010-01-01", periods=900, freq="D", tz="UTC")
    fed = pd.Series(2.0, index=index)
    curve = pd.Series(1.0, index=index)
    unrate = pd.Series(4.0, index=index)

    fed_only = calculate_macro_strength_components(
        pd.DataFrame({"FEDFUNDS": fed}, index=index)
    )
    fed_curve = calculate_macro_strength_components(
        pd.DataFrame({"FEDFUNDS": fed, "T10Y2Y": curve}, index=index)
    )
    labor_only = calculate_macro_strength_components(
        pd.DataFrame({"UNRATE": unrate}, index=index)
    )
    full = calculate_macro_strength_components(
        pd.DataFrame(
            {"FEDFUNDS": fed, "T10Y2Y": curve, "UNRATE": unrate},
            index=index,
        )
    )

    assert fed_only["macro_strength_coverage"].max() == pytest.approx(0.30)
    assert fed_curve["macro_strength_coverage"].max() == pytest.approx(0.60)
    assert labor_only["macro_strength_coverage"].max() == pytest.approx(0.40)
    assert full["macro_strength_coverage"].max() == pytest.approx(1.0)


def test_rapid_fed_cut_scores_below_slow_easing():
    index = pd.date_range("2018-01-01", periods=520, freq="D", tz="UTC")
    slow = pd.Series(5.0, index=index)
    rapid = pd.Series(5.0, index=index)
    slow.iloc[-180:] = np.linspace(5.0, 2.0, 180)
    rapid.iloc[-30:] = np.linspace(5.0, 2.0, 30)

    slow_components = calculate_macro_strength_components(
        pd.DataFrame(
            {
                "FEDFUNDS": slow,
                "T10Y2Y": pd.Series(1.0, index=index),
            },
            index=index,
        )
    )
    rapid_components = calculate_macro_strength_components(
        pd.DataFrame(
            {
                "FEDFUNDS": rapid,
                "T10Y2Y": pd.Series(1.0, index=index),
            },
            index=index,
        )
    )

    slow_fed = slow_components["fed_score"].iloc[-1]
    rapid_fed = rapid_components["fed_score"].iloc[-1]
    assert slow_fed > 50.0
    assert rapid_fed < 20.0
    assert rapid_fed < slow_fed
    assert (
        rapid_components["macro_strength"].iloc[-1]
        < slow_components["macro_strength"].iloc[-1]
    )


def test_rapid_curve_uninversion_is_penalised():
    index = pd.date_range("2018-01-01", periods=520, freq="D", tz="UTC")
    curve = pd.Series(-1.0, index=index)
    curve.iloc[-29:] = np.linspace(0.0, 2.0, 29)

    components = calculate_macro_strength_components(
        pd.DataFrame(
            {
                "FEDFUNDS": pd.Series(4.0, index=index),
                "T10Y2Y": curve,
            },
            index=index,
        )
    )

    assert components["curve_uninversion_pressure"].iloc[-1] > 90.0
    assert components["curve_cross_score"].iloc[-1] < 25.0
    assert not bool(components["curve_inverted"].iloc[-1])


def test_sahm_alert_caps_composite_at_recession_floor():
    index = pd.date_range("2018-01-01", periods=760, freq="D", tz="UTC")
    unrate = pd.Series(4.0, index=index)
    unrate.iloc[400:] = np.linspace(4.0, 4.9, len(index) - 400)

    components = calculate_macro_strength_components(
        pd.DataFrame(
            {
                "FEDFUNDS": pd.Series(5.0, index=index),
                "T10Y2Y": pd.Series(1.0, index=index),
                "UNRATE": unrate,
            },
            index=index,
        )
    )

    latest = components.iloc[-1]
    assert bool(latest["sahm_alert"])
    assert latest["labor_gap"] >= 0.5
    assert latest["labor_score"] == 0.0
    assert latest["macro_strength"] <= 10.0
    assert latest["regime_state"] == "disruptive"


def test_strength_components_include_regime_state_and_phase_features():
    index = pd.date_range("2010-01-01", periods=1600, freq="D", tz="UTC")
    frame = pd.DataFrame(
        {
            "FEDFUNDS": np.linspace(5.0, 0.0, len(index)),
            "T10Y2Y": np.linspace(-1.0, 2.0, len(index)),
            "sp500_proxy": np.linspace(1000.0, 2000.0, len(index))
            * (1.0 + np.sin(np.arange(len(index)) / 20.0) * 0.02),
            "sp500_proxy_source": "SP500",
        },
        index=index,
    )

    components = calculate_macro_strength_components(frame)

    assert {
        "macro_strength",
        "regime_state",
        "fed_cross",
        "curve_cross",
        "volatility_1y",
        "drawdown_1y",
        "1y_volatility_percentile",
    }.issubset(components.columns)

    states = components["regime_state"].dropna().unique().tolist()
    assert set(states).issubset({"favorable", "neutral", "disruptive"})

    percentiles = components["1y_volatility_percentile"].dropna()
    assert not percentiles.empty
    assert percentiles.between(0.0, 100.0).all()

    drawdowns = components["drawdown_1y"].dropna()
    assert not drawdowns.empty
    assert (drawdowns <= 0.0).all()


def test_timeline_point_exposes_volatility_percentile_alias():
    from regime.schemas import TimelinePoint

    point = TimelinePoint(
        date="2020-01-01",
        **{"1y_volatility_percentile": 63.4},
    )
    assert point.volatility_percentile_1y == 63.4
    assert point.model_dump(by_alias=True)["1y_volatility_percentile"] == 63.4


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


def test_asset_targets_serialize_gold_bonds_and_dollar():
    index = pd.date_range("2010-01-01", periods=900, freq="D", tz="UTC")
    frame = pd.DataFrame(
        {
            "GOLD_LBMA": np.linspace(1000.0, 2000.0, len(index)),
            "BTCUSD": np.linspace(100.0, 50000.0, len(index)),
            "DTWEXBGS": np.linspace(90.0, 120.0, len(index)),
            "DGS10": np.linspace(4.0, 2.0, len(index)),
        },
        index=index,
    )

    assets = build_asset_targets(frame)
    components = calculate_macro_strength_components(assets)

    assert {
        "gold_proxy",
        "gold_proxy_source",
        "bond_proxy",
        "bond_proxy_source",
        "btc_proxy",
        "btc_proxy_source",
        "dxy_proxy",
        "dxy_proxy_source",
    }.issubset(assets.columns)
    assert assets["gold_proxy"].iloc[-1] == pytest.approx(2000.0)
    assert assets["bond_proxy"].iloc[-1] > 0.0
    assert assets["bond_proxy_source"].iloc[-1] == "UST10Y_TOTAL_RETURN_PROXY"
    assert assets["btc_proxy"].iloc[-1] == pytest.approx(50000.0)
    assert assets["btc_proxy_source"].iloc[-1] == "BLOCKCHAIN_COM_MARKET_PRICE"
    assert {
        "gold_volatility_1y",
        "gold_drawdown_1y",
        "gold_1y_volatility_percentile",
        "bond_volatility_1y",
        "bond_drawdown_1y",
        "bond_1y_volatility_percentile",
        "btc_volatility_1y",
        "btc_drawdown_1y",
        "btc_1y_volatility_percentile",
        "dxy_volatility_1y",
        "dxy_drawdown_1y",
        "dxy_1y_volatility_percentile",
    }.issubset(components.columns)
    assert components["bond_volatility_1y"].notna().any()


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


def test_core_index_composite_is_bounded_and_bucketed():
    index = pd.date_range("1996-01-01", "2020-12-31", freq="D", tz="UTC")
    trend = np.linspace(100.0, 1200.0, len(index))
    credit = pd.Series(np.nan, index=index, dtype="float64")
    credit.loc["1996-12-31":] = 4.0 + 0.8 * np.sin(
        np.linspace(0.0, 50.0, len(credit.loc["1996-12-31":]))
    )
    frame = pd.DataFrame(
        {
            "sp500_proxy": trend,
            "sp500_proxy_source": "TEST",
            "BAMLH0A0HYM2": credit,
            "fed_score": 55.0,
            "curve_score": 50.0,
        },
        index=index,
    )

    out = calculate_core_index(frame)
    scored = out["core_index"].dropna()

    assert scored.index.min() >= pd.Timestamp("1996-12-31", tz="UTC")
    assert scored.between(-50.0, 50.0).all()
    assert set(out["core_index_bucket"].dropna().unique()).issubset(
        {
            "strong_bullish",
            "calm_bullish",
            "bearish_warning",
            "extreme_bearish",
        }
    )
    assert np.allclose(
        scored,
        out.loc[scored.index, "core_index_composite"] - 50.0,
    )
    assert {"macro_score", "atr_pct", "bollinger_width", "rsi_14"}.issubset(
        out.columns
    )


def test_blockchain_bitcoin_parser_filters_nonpositive_and_prehistory():
    payload = (
        b'{"values":['
        b'{"x":1230940800,"y":0.0},'
        b'{"x":1276560000,"y":0.06},'
        b'{"x":1276646400,"y":-1.0},'
        b'{"x":1276732800,"y":1.25},'
        b'{"x":1276819200,"y":2.0}'
        b']}'
    )
    series = _parse_blockchain_bitcoin(payload)
    assert len(series) == 3
    assert series.iloc[0] == 0.06
    assert series.index.min() >= pd.Timestamp("2010-01-01", tz="UTC")
    assert series.name == "BTCUSD"


def test_sp500_proxy_carries_current_source_over_stale_tail():
    index = pd.date_range("2020-01-01", periods=10, freq="D", tz="UTC")
    frame = pd.DataFrame(index=index)
    raw = pd.DataFrame(index=index)
    raw["SP500"] = np.nan
    raw.loc["2020-01-01":"2020-01-08", "SP500"] = np.linspace(3000.0, 3070.0, 8)
    raw["NASDAQCOM"] = np.linspace(9000.0, 9100.0, len(index))

    proxy = build_sp500_proxy(frame, raw_frame=raw)

    assert proxy["sp500_proxy_source"].dropna().unique().tolist() == ["SP500"]
    assert proxy["sp500_proxy"].iloc[-1] == pytest.approx(3070.0)
