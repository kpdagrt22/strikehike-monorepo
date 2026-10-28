from __future__ import annotations

import hashlib
import json
import sys
from fractions import Fraction
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

from regime.analytics import (  # noqa: E402
    CORE_INDEX_INPUT_LAGS,
    CORE_INDEX_NOTE,
    CORE_INDEX_SEVERITIES,
    CORE_INDEX_TREND_RECORD,
    CORE_INDEX_TREND_RULE,
    CORE_INDEX_TREND_WEEKS,
    CORE_INDEX_V1_LEGACY_COLUMNS,
    CORE_INDEX_V2_COLUMNS,
    CORE_INDEX_VERSION,
    SP500_DAILY_SOURCE,
    STRENGTH_VERSION,
    STRENGTH_WEIGHTS,
    _core_index_bucket,
    _core_index_trend_warning,
    _core_index_v2_inputs,
    _core_index_v2_state,
    annotate_nber,
    build_crashes,
    build_sp500_proxy,
    calculate_core_index,
    calculate_core_index_v2,
    calculate_macro_strength,
    calculate_macro_strength_components,
    nber_episodes,
)
from scripts.flows.macro_ingestion import (  # noqa: E402
    SERIES_REGISTRY,
    SP500_BAD_PRINTS,
    SP500_OFFICIAL_CORRECTIONS,
    SP500_RECONCILE_TOLERANCE,
    MacroConfigError,
    SeriesShapeError,
    _parse_blockchain_bitcoin,
    _parse_yahoo_nifty,
    _parse_yahoo_sp500,
    append_official_sp500_tail,
    build_asset_targets,
    build_macro_frame,
    build_raw_daily_frame,
    check_sp500_daily_shape,
    drop_sp500_bad_prints,
    fetch_nifty_series,
    fetch_sp500_daily_series,
    find_flat_runs,
    parse_fred_observations,
    reconcile_sp500_daily,
    redact_secrets,
    run_pipeline,
    select_specs,
)
from scripts.flows import macro_ingestion  # noqa: E402


def test_fred_errors_never_carry_the_api_key(monkeypatch):
    secret = "0123456789abcdef0123456789abcdef"
    assert redact_secrets(f"url: /fred/series?api_key={secret}&file_type=json") == (
        "url: /fred/series?api_key=REDACTED&file_type=json"
    )
    assert redact_secrets("no credentials here") == "no credentials here"

    class _FailingSession:
        headers: dict = {}

        def get(self, url, params=None, timeout=None):
            query = "&".join(f"{key}={value}" for key, value in (params or {}).items())
            raise macro_ingestion.requests.ConnectionError(
                f"Max retries exceeded with url: {url}?{query}"
            )

    client = macro_ingestion.FredClient(secret, max_retries=0, delay=0.0)
    client._session = _FailingSession()
    with pytest.raises(macro_ingestion.FredAPIError) as excinfo:
        client.fetch_series("UNRATE")
    assert secret not in str(excinfo.value)
    assert "api_key=REDACTED" in str(excinfo.value)


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
    # Was pinned to the old Cowles -> Dow-Jones -> SP500/Nasdaq splice, which
    # labelled Dow and Nasdaq levels as the S&P. Daily ^GSPC now wins wherever
    # it has a value, Cowles fills only the earlier dates, and Dow/Nasdaq are
    # ignored even when present.
    index = pd.date_range("2020-01-01", periods=3, freq="D", tz="UTC")
    frame = pd.DataFrame(
        {
            "M1125AUSM343NNBR": [100.0, 110.0, np.nan],
            "M1109BUSM293NNBR": [90.0, 200.0, 210.0],
            "GSPC": [np.nan, 300.0, 400.0],
            "SP500": [np.nan, 301.0, 401.0],
            "NASDAQCOM": [250.0, 260.0, 350.0],
        },
        index=index,
    )
    proxy = build_sp500_proxy(frame)
    assert proxy["sp500_proxy"].tolist() == [100.0, 300.0, 400.0]
    assert proxy["sp500_proxy_source"].tolist() == [
        "M1125AUSM343NNBR",
        "YAHOO_FINANCE_GSPC",
        "YAHOO_FINANCE_GSPC",
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
    # Was pinned to Dow-Jones and Nasdaq segments, which are no longer S&P
    # inputs. Each remaining source still fills only up to its own last raw
    # observation, Dow/Nasdaq days stay empty, and FRED SP500 only fills dates
    # after the last daily ^GSPC close.
    index = pd.date_range("2020-01-01", periods=5, freq="D", tz="UTC")
    frame = pd.DataFrame(index=index)
    raw = pd.DataFrame(
        {
            "M1125AUSM343NNBR": [100.0, np.nan, np.nan, np.nan, np.nan],
            "M1109BUSM293NNBR": [np.nan, 200.0, np.nan, np.nan, np.nan],
            "NASDAQCOM": [np.nan, np.nan, 350.0, np.nan, np.nan],
            "GSPC": [np.nan, np.nan, np.nan, 300.0, np.nan],
            "SP500": [np.nan, np.nan, np.nan, np.nan, 400.0],
        },
        index=index,
    )
    proxy = build_sp500_proxy(frame, raw_frame=raw)
    values = proxy["sp500_proxy"]
    assert values.isna().tolist() == [False, True, True, False, False]
    assert values.dropna().tolist() == [100.0, 300.0, 400.0]
    assert proxy["sp500_proxy_source"].fillna("").tolist() == [
        "M1125AUSM343NNBR",
        "",
        "",
        "YAHOO_FINANCE_GSPC",
        "SP500",
    ]


def test_core_index_composite_is_bounded_and_bucketed():
    # NASDAQCOM is a daily-close source label older artifacts carried; v2
    # scores it like ^GSPC. (With a non-daily label v2 would never score.)
    index = pd.date_range("1996-01-01", "2020-12-31", freq="D", tz="UTC")
    trend = np.linspace(100.0, 1200.0, len(index))
    credit = pd.Series(np.nan, index=index, dtype="float64")
    credit.loc["1996-12-31":] = 4.0 + 0.8 * np.sin(
        np.linspace(0.0, 50.0, len(credit.loc["1996-12-31":]))
    )
    frame = pd.DataFrame(
        {
            "sp500_proxy": trend,
            "sp500_proxy_source": "NASDAQCOM",
            "BAMLH0A0HYM2": credit,
            "fed_score": 55.0,
            "curve_score": 50.0,
        },
        index=index,
    )

    out = calculate_core_index(frame)
    scored = out["core_index"].dropna()

    assert len(scored) > 6000
    assert scored.between(-50.0, 50.0).all()
    assert set(out["core_index_bucket"].dropna().unique()).issubset(
        {
            "strong_bullish",
            "calm_bullish",
            "bearish_warning",
            "extreme_bearish",
        }
    )
    np.testing.assert_array_equal(
        out.loc[scored.index, "core_index_composite"],
        scored + 50.0,
    )
    # The v1 diagnostics are still written, unchanged, and still start with
    # the credit series.
    assert {"macro_score", "atr_pct", "bollinger_width", "rsi_14"}.issubset(
        out.columns
    )
    assert set(CORE_INDEX_V1_LEGACY_COLUMNS).issubset(out.columns)
    assert out["macro_score"].first_valid_index() >= pd.Timestamp(
        "1996-12-31", tz="UTC"
    )
    assert list(out.columns) == [
        *CORE_INDEX_V1_LEGACY_COLUMNS,
        "core_index_composite",
        "core_index",
        "core_index_bucket",
        "core_index_severity",
        "core_index_warning",
        "core_index_trend_warning",
    ]


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


def test_sp500_proxy_from_1928_comes_only_from_daily_gspc():
    # Every input keeps its real coverage: Cowles 1871-1956 and Dow-Jones
    # 1914-1968 monthly, Nasdaq 1971+, FRED SP500 2016+ and ^GSPC 1927-12-30+.
    cowles = pd.date_range("1871-01-01", "1956-12-01", freq="MS", tz="UTC")
    dow = pd.date_range("1914-12-01", "1968-12-01", freq="MS", tz="UTC")
    nasdaq = pd.bdate_range("1971-02-05", "2026-10-26", tz="UTC")
    fred = pd.bdate_range("2016-10-27", "2026-10-23", tz="UTC")
    gspc = pd.bdate_range("1927-12-30", "2026-10-27", tz="UTC")
    series_map = {
        "M1125AUSM343NNBR": pd.Series(np.linspace(37.0, 340.0, len(cowles)), index=cowles),
        "M1109BUSM293NNBR": pd.Series(np.linspace(55.0, 965.0, len(dow)), index=dow),
        "SP500": pd.Series(np.linspace(2133.0, 7624.0, len(fred)), index=fred),
        "NASDAQCOM": pd.Series(np.linspace(100.0, 26169.0, len(nasdaq)), index=nasdaq),
        "GSPC": pd.Series(np.linspace(17.66, 7722.6, len(gspc)), index=gspc),
    }
    frame = build_macro_frame(series_map)
    proxy = build_sp500_proxy(
        frame, raw_frame=build_raw_daily_frame(series_map, frame.index)
    )

    first_daily = pd.Timestamp("1927-12-30", tz="UTC")
    after = proxy.loc[first_daily:]
    assert after["sp500_proxy"].notna().all()
    assert after["sp500_proxy_source"].notna().all()
    assert set(after["sp500_proxy_source"]) == {"YAHOO_FINANCE_GSPC"}
    pd.testing.assert_series_equal(
        after["sp500_proxy"],
        frame.loc[first_daily:, "GSPC"],
        check_names=False,
    )
    before = proxy.loc[: first_daily - pd.Timedelta(days=1)]
    assert set(before["sp500_proxy_source"].dropna()) == {"M1125AUSM343NNBR"}
    assert proxy["sp500_proxy"].first_valid_index() == pd.Timestamp(
        "1871-01-01", tz="UTC"
    )
    assert not proxy["sp500_proxy_source"].isin(
        ["M1109BUSM293NNBR", "NASDAQCOM", "SP500"]
    ).any()


def test_sp500_proxy_daily_source_carries_over_stale_tail_without_fred_splice():
    index = pd.date_range("2020-01-01", periods=10, freq="D", tz="UTC")
    frame = pd.DataFrame(index=index)
    raw = pd.DataFrame(index=index)
    raw["GSPC"] = np.nan
    raw.loc["2020-01-01":"2020-01-08", "GSPC"] = np.linspace(3000.0, 3070.0, 8)
    raw["SP500"] = np.linspace(3001.0, 3101.0, len(index))

    proxy = build_sp500_proxy(frame, raw_frame=raw)

    assert proxy["sp500_proxy_source"].dropna().unique().tolist() == [
        "YAHOO_FINANCE_GSPC"
    ]
    assert proxy["sp500_proxy"].iloc[-1] == pytest.approx(3070.0)


@pytest.mark.parametrize(
    ("parser", "series_id"),
    [(_parse_yahoo_sp500, "GSPC"), (_parse_yahoo_nifty, "NIFTY50")],
)
def test_yahoo_chart_parsers_share_one_parse(parser, series_id):
    # ^GSPC history starts before the Unix epoch, so its timestamps are negative.
    stamps = [
        int(pd.Timestamp(value, tz="UTC").timestamp())
        for value in (
            "1927-12-30 14:30",
            "1928-01-03 14:30",
            "2026-10-22 13:30",
            "2026-10-23 13:30",
            "2026-10-26 13:30",
            "2026-10-26 20:00",
        )
    ]
    payload = json.dumps(
        {
            "chart": {
                "result": [
                    {
                        "timestamp": stamps,
                        "indicators": {
                            "quote": [
                                {"close": [17.66, 17.76, None, -1.0, 7676.0, 7676.77]}
                            ]
                        },
                    }
                ],
                "error": None,
            }
        }
    ).encode()

    series = parser(payload)

    assert series.name == series_id
    assert series.tolist() == [17.66, 17.76, 7676.77]
    assert series.index.tolist() == [
        pd.Timestamp("1927-12-30", tz="UTC"),
        pd.Timestamp("1928-01-03", tz="UTC"),
        pd.Timestamp("2026-10-26", tz="UTC"),
    ]
    with pytest.raises(ValueError):
        parser(b'{"chart": {"result": null, "error": {"code": "Not Found"}}}')


def test_fetch_sp500_daily_series_offline_reads_cache_only(tmp_path, monkeypatch):
    def no_network(*args, **kwargs):
        raise AssertionError("offline mode must not call Yahoo Finance")

    monkeypatch.setattr("requests.get", no_network)
    with pytest.raises(MacroConfigError):
        fetch_sp500_daily_series(tmp_path, refresh=False, offline=True)

    pd.DataFrame(
        {"date": ["1927-12-30", "1928-01-03"], "value": [17.66, 17.76]}
    ).to_csv(tmp_path / "GSPC.csv", index=False)
    series = fetch_sp500_daily_series(tmp_path, refresh=False, offline=True)

    assert series.name == "GSPC"
    assert series.tolist() == [17.66, 17.76]
    assert series.index[0] == pd.Timestamp("1927-12-30", tz="UTC")


def test_reconcile_sp500_daily_replaces_only_vendor_print_errors():
    index = pd.to_datetime(
        ["2021-08-10", "2021-08-11", "2021-08-12", "2026-10-27"], utc=True
    )
    yahoo = pd.Series(
        [4436.75, 4442.41, 4460.830078125, 7722.60009765625],
        index=index,
        name="GSPC",
    )
    fred = pd.Series([4436.75, 4447.70, 4460.83], index=index[:3], name="SP500")
    warnings: list[str] = []

    # Live check only (no committed list): a new mismatch is fixed for this
    # build and a warning asks for it to be committed.
    reconciled, report = reconcile_sp500_daily(
        yahoo, fred, committed={}, warnings=warnings
    )

    # Float noise below half a cent is kept; the 5.29-point print error is not.
    assert reconciled.tolist() == [4436.75, 4447.70, 4460.830078125, 7722.60009765625]
    assert reconciled.name == "GSPC"
    assert report["overlap_days"] == 3
    assert report["replaced"] == {
        "2021-08-11": {
            "yahoo": 4442.41,
            "fred": 4447.7,
            "committed": False,
            "in_fred_window": True,
        }
    }
    assert yahoo.iloc[1] == 4442.41
    assert len(warnings) == 1 and "SP500_OFFICIAL_CORRECTIONS" in warnings[0]

    unchanged, empty = reconcile_sp500_daily(yahoo, None, committed={})
    assert unchanged.equals(yahoo)
    assert empty["overlap_days"] == 0 and empty["replaced"] == {}


def test_committed_sp500_corrections_survive_fred_window_moving():
    # Yahoo's prints on every committed date (two as the float32 values in the
    # cache), plus one ordinary later close.
    prints = {day: vendor for day, (vendor, _official) in SP500_OFFICIAL_CORRECTIONS.items()}
    prints["2019-08-12"] = 2882.699951171875
    prints["2021-08-11"] = 4442.41015625
    prints["2026-10-27"] = 7722.60009765625
    yahoo = pd.Series(prints, name="GSPC")
    yahoo.index = pd.to_datetime(yahoo.index, utc=True)
    yahoo = yahoo.sort_index()
    later_fred = pd.Series(
        [7722.6], index=pd.to_datetime(["2026-10-27"], utc=True), name="SP500"
    )
    expected = [official for _day, (_vendor, official) in sorted(SP500_OFFICIAL_CORRECTIONS.items())]
    warnings: list[str] = []

    # FRED's ten-year window no longer covers these dates (None, or only later
    # dates): the committed official closes still apply.
    for official in (None, later_fred):
        reconciled, report = reconcile_sp500_daily(
            yahoo, official, warnings=warnings
        )
        assert reconciled.tolist() == expected + [7722.60009765625]
        assert reconciled.loc["2019-08-12"] == 2883.75
        assert reconciled.loc["2021-08-11"] == 4447.70
        assert set(report["replaced"]) == set(SP500_OFFICIAL_CORRECTIONS)
        assert all(
            entry["committed"] and not entry["in_fred_window"]
            for entry in report["replaced"].values()
        )
        assert report["committed_corrections"] == len(SP500_OFFICIAL_CORRECTIONS)
    assert warnings == []


def test_committed_sp500_correction_needs_the_recorded_print():
    index = pd.to_datetime(["2021-08-11"], utc=True)
    committed = {"2021-08-11": (4442.41, 4447.70)}
    warnings: list[str] = []

    # Yahoo fixed the print itself: nothing to do, nothing to report.
    fixed, report = reconcile_sp500_daily(
        pd.Series([4447.70], index=index, name="GSPC"),
        None,
        committed=committed,
        warnings=warnings,
    )
    assert fixed.tolist() == [4447.70] and report["replaced"] == {}
    assert warnings == []

    # Yahoo now serves a third value: leave it and say so.
    other, report = reconcile_sp500_daily(
        pd.Series([4450.00], index=index, name="GSPC"),
        None,
        committed=committed,
        warnings=warnings,
    )
    assert other.tolist() == [4450.00] and report["replaced"] == {}
    assert len(warnings) == 1 and "not applied" in warnings[0]


def test_drop_sp500_bad_prints_drops_listed_prints_only():
    days = [
        "1929-10-28", "1929-10-29", "1929-10-30",
        "1935-04-15", "1935-04-16", "1935-04-17",
        "1936-09-15", "1936-09-16", "1936-09-17",
    ]
    closes = [22.74, 20.43, 22.99, 9.13, 8.220000267028809, 9.01, 15.93, 15.90, 15.87]
    daily = pd.Series(closes, index=pd.to_datetime(days, utc=True), name="GSPC")
    listed = {
        "1935-04-16": (8.22, "typo"),
        "1936-09-16": (15.00, "typo"),
    }
    warnings: list[str] = []

    cleaned, entries = drop_sp500_bad_prints(
        daily, bad_prints=listed, warnings=warnings
    )

    # Only the listed print that Yahoo still serves is dropped. Black Tuesday
    # (a real reversal) and a listed date whose vendor value changed stay.
    assert pd.Timestamp("1935-04-16", tz="UTC") not in cleaned.index
    assert len(cleaned) == len(daily) - 1
    assert cleaned.loc["1929-10-29"] == 20.43
    assert cleaned.loc["1936-09-16"] == 15.90
    first, second = entries
    assert first["status"] == "dropped"
    assert first["previous"] == {"date": "1935-04-15", "close": 9.13}
    assert first["next"] == {"date": "1935-04-17", "close": 9.01}
    assert first["vendor_close"] == 8.22 and first["reason"] == "typo"
    assert second["status"].startswith("kept") and second["vendor_close_now"] == 15.9
    assert len(warnings) == 1 and "1936-09-16" in warnings[0]

    # No value is invented: the daily frame carries the previous close.
    frame = build_macro_frame({"GSPC": cleaned})
    assert frame.loc["1935-04-16", "GSPC"] == 9.13
    assert frame.loc["1935-04-17", "GSPC"] == 9.01


def test_curated_sp500_lists_are_reviewed_entries_not_a_spike_filter():
    real_reversals = {
        "1929-10-28", "1929-10-29", "1929-10-30", "1931-10-05", "1931-10-06",
        "1987-10-19", "1987-10-20", "2011-08-08", "2011-08-09", "2011-08-10",
        "2020-03-12", "2020-03-13", "2020-03-16", "2020-03-17",
    }
    assert not real_reversals & set(SP500_BAD_PRINTS)
    assert len(SP500_BAD_PRINTS) == 6
    for day, (vendor_close, reason) in SP500_BAD_PRINTS.items():
        assert pd.Timestamp(day).dayofweek < 5
        assert vendor_close > 0 and len(reason) > 40
    for day, (vendor_close, official_close) in SP500_OFFICIAL_CORRECTIONS.items():
        assert pd.Timestamp(day) >= pd.Timestamp("2016-10-27")
        assert abs(vendor_close - official_close) > SP500_RECONCILE_TOLERANCE


def test_append_official_sp500_tail_when_yahoo_is_stale():
    yahoo = pd.Series(
        [7744.06, 7659.44],
        index=pd.to_datetime(["2026-10-15", "2026-10-16"], utc=True),
        name="GSPC",
    )
    fred_days = pd.to_datetime(
        ["2026-10-15", "2026-10-16", "2026-10-19", "2026-10-20"], utc=True
    )
    fred = pd.Series([7744.06, 7659.44, 7690.73, 7712.57], index=fred_days, name="SP500")
    warnings: list[str] = []

    extended, report = append_official_sp500_tail(yahoo, fred, warnings=warnings)

    assert extended.name == "GSPC"
    assert extended.tolist() == [7744.06, 7659.44, 7690.73, 7712.57]
    assert report["after_last_yahoo_close"] == "2026-10-16"
    assert report["closes"] == {"2026-10-19": 7690.73, "2026-10-20": 7712.57}
    assert len(warnings) == 1 and "2 later close(s)" in warnings[0]

    # Normal case: Yahoo is ahead of FRED, nothing changes.
    same, empty = append_official_sp500_tail(extended, fred.iloc[:2], warnings=warnings)
    assert same is extended and empty == {} and len(warnings) == 1


@pytest.mark.parametrize("fetch", [fetch_sp500_daily_series, fetch_nifty_series])
def test_failed_yahoo_fetch_with_stale_cache_is_a_warning(tmp_path, monkeypatch, fetch):
    import os

    import requests

    series_id = "GSPC" if fetch is fetch_sp500_daily_series else "NIFTY50"
    cache = tmp_path / f"{series_id}.csv"
    pd.DataFrame({"date": ["1927-12-30", "1928-01-03"], "value": [17.66, 17.76]}).to_csv(
        cache, index=False
    )
    old = cache.stat().st_mtime - 72 * 3600
    os.utime(cache, (old, old))

    def offline_network(*args, **kwargs):
        raise requests.ConnectionError("simulated outage")

    monkeypatch.setattr("requests.get", offline_network)
    warnings: list[str] = []
    series = fetch(tmp_path, refresh=False, offline=False, warnings=warnings)

    assert series.tolist() == [17.66, 17.76]
    assert len(warnings) == 1
    assert warnings[0].startswith(f"{series_id}: Yahoo Finance fetch failed")
    assert "stale cache used (last close 1928-01-03)" in warnings[0]


def _chart_payload(stamps, closes, start, end, gmtoffset):
    return json.dumps(
        {
            "chart": {
                "result": [
                    {
                        "meta": {
                            "gmtoffset": gmtoffset,
                            "currentTradingPeriod": {
                                "regular": {
                                    "start": int(pd.Timestamp(start, tz="UTC").timestamp()),
                                    "end": int(pd.Timestamp(end, tz="UTC").timestamp()),
                                    "gmtoffset": gmtoffset,
                                }
                            },
                        },
                        "timestamp": [
                            int(pd.Timestamp(value, tz="UTC").timestamp())
                            for value in stamps
                        ],
                        "indicators": {"quote": [{"close": closes}]},
                    }
                ],
                "error": None,
            }
        }
    ).encode()


@pytest.mark.parametrize("parser", [_parse_yahoo_sp500, _parse_yahoo_nifty])
def test_yahoo_parsers_drop_the_bar_of_an_unfinished_session(parser):
    # Mid-session in Mumbai (NSE 09:15-15:30 IST = 03:45-10:00 UTC): the live
    # 2026-10-28 bar is dropped until the session ends; yesterday's close stays.
    nse = _chart_payload(
        ["2026-10-26 03:45", "2026-10-27 03:45", "2026-10-28 03:45"],
        [22753.2, 22700.5, 22810.0],
        "2026-10-28 03:45",
        "2026-10-28 10:00",
        19800,
    )
    during = parser(nse, now=pd.Timestamp("2026-10-28 08:30", tz="UTC"))
    assert during.index[-1] == pd.Timestamp("2026-10-27", tz="UTC")
    assert during.iloc[-1] == 22700.5
    after = parser(nse, now=pd.Timestamp("2026-10-28 10:00", tz="UTC"))
    assert after.index[-1] == pd.Timestamp("2026-10-28", tz="UTC")

    # Before the New York open the payload already describes today's session;
    # yesterday's final close must not be dropped.
    premarket = _chart_payload(
        ["2026-10-26 13:30", "2026-10-27 13:30"],
        [7676.77, 7722.60],
        "2026-10-28 13:30",
        "2026-10-28 20:00",
        -14400,
    )
    kept = parser(premarket, now=pd.Timestamp("2026-10-28 08:09", tz="UTC"))
    assert kept.tolist() == [7676.77, 7722.60]

    # During the session, a live bar stamped at the last trade goes as well.
    live = _chart_payload(
        ["2026-10-27 13:30", "2026-10-28 13:30", "2026-10-28 17:05"],
        [7722.60, 7701.0, 7698.5],
        "2026-10-28 13:30",
        "2026-10-28 20:00",
        -14400,
    )
    trimmed = parser(live, now=pd.Timestamp("2026-10-28 17:10", tz="UTC"))
    assert trimmed.tolist() == [7722.60]

    # An unexpected meta shape disables the guard instead of failing the parse.
    for odd_meta in ([], {"currentTradingPeriod": [[{"start": 0, "end": 1}]]}, {"currentTradingPeriod": {"regular": {"start": "x"}}}):
        payload = json.loads(live)
        payload["chart"]["result"][0]["meta"] = odd_meta
        series = parser(json.dumps(payload).encode(), now=pd.Timestamp("2026-10-28 17:10", tz="UTC"))
        assert series.tolist() == [7722.60, 7698.5]


def test_check_sp500_daily_shape_refuses_missing_or_truncated_history():
    full_days = pd.bdate_range("1927-12-30", "2026-10-27", tz="UTC")
    full = pd.Series(np.linspace(17.66, 7722.6, len(full_days)), index=full_days)
    check_sp500_daily_shape(full)

    for broken in (
        None,
        full.iloc[:0],
        full.loc["1970-01-01":],  # starts too late
        full.iloc[:5000],  # too few closes
        full.drop(full.loc["1990-01-01":"1990-02-15"].index),  # mid-history hole
    ):
        with pytest.raises(SeriesShapeError):
            check_sp500_daily_shape(broken)


def test_find_flat_runs_lists_repeated_closes():
    days = pd.to_datetime(
        ["1979-08-27", "1979-08-28", "1979-08-29", "1979-08-30", "1979-08-31"],
        utc=True,
    )
    daily = pd.Series([109.14, 109.02, 109.02, 109.020000001, 109.32], index=days)
    assert find_flat_runs(daily) == [
        {"start": "1979-08-28", "end": "1979-08-30", "sessions": 3, "close": 109.02}
    ]
    assert find_flat_runs(daily, min_sessions=4) == []


def test_run_pipeline_refuses_to_write_without_daily_sp500(tmp_path):
    cache = tmp_path / "cache"
    output = tmp_path / "out"
    cache.mkdir()
    pd.DataFrame(
        {"date": ["2020-01-01", "2020-02-01"], "value": [0.0, 0.0]}
    ).to_csv(cache / "USREC.csv", index=False)

    with pytest.raises(SeriesShapeError, match="artifact is not written"):
        run_pipeline(
            series_ids="USREC",
            offline=True,
            api_key="",
            cache_dir=cache,
            output_dir=output,
        )
    assert not (output / "macro_regime_history.parquet").exists()
    assert not (output / "macro_regime_history.meta.json").exists()


def test_run_pipeline_reports_stale_yahoo_and_uses_fred_tail(tmp_path, monkeypatch):
    import os
    from datetime import datetime, timezone

    import requests

    cache = tmp_path / "cache"
    output = tmp_path / "out"
    cache.mkdir()

    # Yahoo cache (stale, ends 2026-10-16) carrying the recorded vendor prints.
    gspc_days = pd.bdate_range("1927-12-30", "2026-10-16", tz="UTC")
    gspc = pd.Series(np.linspace(17.66, 7659.44, len(gspc_days)), index=gspc_days)
    for day, (vendor_close, _official) in SP500_OFFICIAL_CORRECTIONS.items():
        gspc.loc[day] = vendor_close
    for day, (vendor_close, _reason) in SP500_BAD_PRINTS.items():
        gspc.loc[day] = vendor_close
    # FRED: same closes on the overlap, official closes on the corrected dates,
    # and five newer closes than the stale Yahoo cache.
    fred_days = pd.bdate_range("2016-10-27", "2026-10-23", tz="UTC")
    fred = gspc.reindex(fred_days)
    for day, (_vendor, official_close) in SP500_OFFICIAL_CORRECTIONS.items():
        fred.loc[day] = official_close
    tail = {
        "2026-10-19": 7690.73,
        "2026-10-20": 7712.57,
        "2026-10-21": 7757.17,
        "2026-10-22": 7663.43,
        "2026-10-23": 7623.68,
    }
    for day, value in tail.items():
        fred.loc[day] = value
    usrec_days = pd.date_range("2015-01-01", "2026-09-01", freq="MS", tz="UTC")
    usrec = pd.Series(0.0, index=usrec_days)
    for name, series in (("GSPC", gspc), ("SP500", fred), ("USREC", usrec)):
        series.rename("value").to_frame().to_csv(
            cache / f"{name}.csv", index_label="date", date_format="%Y-%m-%d"
        )
    fresh = datetime.now(timezone.utc).isoformat()
    (cache / "_manifest.json").write_text(
        json.dumps({"series": {"SP500": {"fetched_at": fresh}, "USREC": {"fetched_at": fresh}}}),
        encoding="utf-8",
    )
    old = (cache / "GSPC.csv").stat().st_mtime - 72 * 3600
    os.utime(cache / "GSPC.csv", (old, old))

    def outage(*args, **kwargs):
        raise requests.ConnectionError("simulated outage")

    monkeypatch.setattr("requests.get", outage)
    monkeypatch.setattr("requests.Session.get", outage)

    run_pipeline(
        source="csv",
        series_ids="SP500,USREC",
        api_key="",
        cache_dir=cache,
        output_dir=output,
    )

    meta = json.loads((output / "macro_regime_history.meta.json").read_text(encoding="utf-8"))
    frame = pd.read_parquet(output / "macro_regime_history.parquet")
    warnings = meta["warnings"]

    # The Yahoo failure and FRED's newer closes are both visible.
    assert any(
        w.startswith("GSPC: Yahoo Finance fetch failed")
        and "stale cache used (last close 2026-10-16)" in w
        for w in warnings
    )
    assert any("FRED's official S&P 500 has 5 later close(s)" in w for w in warnings)
    assert not any("committed correction" in w or "bad print" in w for w in warnings)
    proxy = meta["proxy"]
    assert proxy["official_tail"]["closes"] == tail
    assert proxy["notes"] == meta["notes"][3:5]
    assert frame.loc["2026-10-23", "sp500_proxy"] == pytest.approx(7623.68)
    assert frame.loc["2026-10-23", "sp500_proxy_source"] == "YAHOO_FINANCE_GSPC"
    assert frame.loc["2026-10-19":"2026-10-23", "sp500_proxy"].tolist() == pytest.approx(
        list(tail.values())
    )

    # Committed corrections and dropped prints are applied and listed.
    replaced = proxy["reconciliation"]["replaced"]
    assert set(replaced) == set(SP500_OFFICIAL_CORRECTIONS)
    assert all(entry["committed"] for entry in replaced.values())
    assert frame.loc["2021-08-11", "sp500_proxy"] == pytest.approx(4447.70)
    assert [entry["status"] for entry in proxy["bad_prints"]] == ["dropped"] * 6
    assert frame.loc["1935-04-16", "GSPC"] == frame.loc["1935-04-15", "GSPC"]

    # The S&P notes describe this build.
    method, limits = meta["notes"][3], meta["notes"][4]
    assert "(^GSPC) from 1927-12-30" in method
    assert "on 9 dates" in method and "misprints on 6 dates (1935-1961)" in method
    assert "FRED's official closes fill 2026-10-19 to 2026-10-23" in method
    assert "restart where the daily series begins (1927-12-30)" in limits
    assert proxy["warm_up"]["segment_start"] == "1927-12-30"


# ---------------------------------------------------------------------------
# Core Index v2
# ---------------------------------------------------------------------------

ARTIFACT_DIR = BACKEND_DIR / "data" / "processed"
ARTIFACT = ARTIFACT_DIR / "macro_regime_history.parquet"
ARTIFACT_META = ARTIFACT_DIR / "macro_regime_history.meta.json"
V2_INPUTS = ["sp500_proxy", "sp500_proxy_source", *CORE_INDEX_INPUT_LAGS]
# The calm Core Index columns share one availability; the trend warning has
# its own (40 Friday closes instead of 53) and reads only the equity close.
TREND = "core_index_trend_warning"
V2_STATE_COLUMNS = [column for column in CORE_INDEX_V2_COLUMNS if column != TREND]
V2_BANDS = {
    "strong_bullish": (25.0, 50.0),
    "calm_bullish": (0.0, 24.0),
    "bearish_warning": (-24.0, -1.0),
    "extreme_bearish": (-50.0, -25.0),
}


def _bump(index: pd.DatetimeIndex, start: str, peak: str, end: str, height: float) -> np.ndarray:
    """0 outside [start, end], rising linearly to ``height`` at ``peak``."""
    days = index.tz_convert(None).values.astype("datetime64[D]").astype(float)
    s, p, e = (np.datetime64(value, "D").astype(float) for value in (start, peak, end))
    rising = np.clip((days - s) / (p - s), 0.0, 1.0)
    falling = np.clip((e - days) / (e - p), 0.0, 1.0)
    return height * np.where(days <= p, rising, falling) * ((days >= s) & (days <= e))


def _v2_synthetic_frame(seed: int = 7, source: str = SP500_DAILY_SOURCE) -> pd.DataFrame:
    """Daily calendar 1988-2012 shaped like the artifact: business-day closes
    and daily FRED series forward-filled over weekends, monthly series stamped
    on day 1 and forward-filled. The equity path has a boom (Trim), a -45%
    decline in 2000-02 and a -50% one in 2008 with volatility spikes
    (capitulation), and recoveries (Accumulate)."""
    rng = np.random.default_rng(seed)
    index = pd.date_range("1988-01-01", "2012-12-31", freq="D", tz="UTC")
    naive = index.tz_convert(None)
    n = len(index)

    def span(start: str, end) -> np.ndarray:
        return (naive >= start) & (naive < end)

    drift = np.full(n, 0.0003)
    sigma = np.full(n, 0.012)
    drift[span("1995-01-01", "2000-03-01")] += 0.0007
    for start, end, depth, spike in (
        ("2000-03-01", "2002-10-10", 0.45, 2.0),
        ("2007-10-01", "2009-03-10", 0.50, 2.5),
    ):
        decline = span(start, end)
        drift[decline] += np.log(1.0 - depth) / decline.sum()
        sigma[span(pd.Timestamp(end) - pd.Timedelta(days=150), end)] *= spike
    drift[span("2002-10-10", "2004-01-01")] += 0.0012
    drift[span("2009-03-10", "2010-06-01")] += 0.0015
    level = 100.0 * np.exp(np.cumsum(rng.normal(drift, sigma)))
    weekend = naive.dayofweek >= 5

    def daily(values: np.ndarray, start: str | None = None) -> pd.Series:
        series = pd.Series(values, index=index).where(~weekend).ffill()
        return series.where(naive >= start) if start else series

    def monthly(values: np.ndarray) -> pd.Series:
        return pd.Series(values, index=index).where(naive.day == 1).ffill()

    noise = rng.normal(0.0, 0.05, n)
    crisis_2000 = ("2000-06-01", "2002-10-01", "2003-10-01")
    crisis_2008 = ("2007-06-01", "2008-12-01", "2009-12-01")
    hy = 4.0 + _bump(index, *crisis_2000, 6.0) + _bump(index, *crisis_2008, 12.0)
    baa_10y = 1.8 + _bump(index, *crisis_2000, 1.4) + _bump(index, *crisis_2008, 3.5)
    aaa = 7.0 + 0.5 * np.sin(np.linspace(0.0, 12.0, n))
    baa = aaa + 1.0 + _bump(index, *crisis_2000, 1.0) + _bump(index, *crisis_2008, 1.8)
    dgs10 = 6.0 - 2.5 * np.linspace(0.0, 1.0, n) + 0.4 * np.sin(np.linspace(0.0, 30.0, n))
    dff = (
        dgs10
        - 1.0
        + _bump(index, "1988-06-01", "1989-06-01", "1990-01-01", 2.0)
        + _bump(index, "1999-10-01", "2000-08-01", "2001-01-01", 2.0)
        + _bump(index, "2006-03-01", "2007-03-01", "2007-10-01", 2.0)
    )
    unemployment = (
        5.0
        + _bump(index, "1990-06-01", "1992-06-01", "1994-01-01", 2.0)
        + _bump(index, "2000-12-01", "2003-06-01", "2005-06-01", 1.5)
        + _bump(index, "2007-12-01", "2009-10-01", "2013-01-01", 5.0)
    )
    usrec = np.zeros(n)
    for start, end in (("1990-08-01", "1991-04-01"), ("2001-04-01", "2001-12-01"), ("2008-01-01", "2009-07-01")):
        usrec[span(start, end)] = 1.0

    frame = pd.DataFrame(
        {
            "sp500_proxy": pd.Series(level, index=index).where(~weekend).ffill(),
            "sp500_proxy_source": pd.array([source] * n, dtype="string"),
            "BAMLH0A0HYM2": daily(hy + noise, start="1997-01-01"),
            "BAA10Y": daily(baa_10y + noise),
            "DGS10": daily(dgs10 + noise),
            "DFF": daily(dff + noise),
            "BAA": monthly(baa),
            "AAA": monthly(aaa),
            "GS10": monthly(dgs10),
            "TB3MS": monthly(dff - 0.1),
            "UNRATE": monthly(np.round(unemployment, 1)),
            "USREC": monthly(usrec),
        },
        index=index,
    )
    frame.index.name = "date"
    return frame


def _labels(series: pd.Series) -> list:
    return series.astype(object).where(series.notna(), None).tolist()


def _assert_v2_equal(expected: pd.DataFrame, actual: pd.DataFrame) -> None:
    """The v2 columns agree: floats within 1e-9, labels exact, NA equal."""
    actual = actual.reindex(expected.index)
    for column in CORE_INDEX_V2_COLUMNS:
        left, right = expected[column], actual[column]
        assert left.isna().tolist() == right.isna().tolist(), column
        if column in ("core_index", "core_index_composite"):
            np.testing.assert_allclose(
                left.to_numpy(dtype=float),
                right.to_numpy(dtype=float),
                rtol=0.0,
                atol=1e-9,
                err_msg=column,
            )
        else:
            assert _labels(left) == _labels(right), column


def test_core_index_v2_no_look_ahead_on_truncated_data():
    frame = _v2_synthetic_frame()
    full = calculate_core_index(frame)
    assert full["core_index"].notna().sum() > 8000

    rng = np.random.default_rng(7)
    days = frame.loc["1990-01-01":"2012-12-30"].index
    for position in sorted(rng.choice(len(days), size=12, replace=False)):
        cut = days[position]
        _assert_v2_equal(full.loc[:cut], calculate_core_index(frame.loc[:cut]))


@pytest.mark.parametrize(
    ("column", "stamp", "run_end", "operation", "known_from", "first_friday_seen"),
    [
        # monthly releases: stamped day 1, known one month (+ release delay) later
        ("UNRATE", "2005-06-01", "2005-06-30", ("add", 1.0), "2005-07-11", "2005-07-15"),
        ("BAA", "2006-03-01", "2006-03-31", ("add", 2.0), "2006-04-02", "2006-04-07"),
        # daily market series: known the next day (a Tuesday print never
        # reaches a Friday sample, a Thursday print reaches the next day's)
        ("DFF", "2007-05-15", "2007-05-15", ("add", 3.0), "2007-05-16", None),
        ("BAMLH0A0HYM2", "2008-01-10", "2008-01-10", ("mul", 1.5), "2008-01-11", "2008-01-11"),
        # the equity close is known the same day
        ("sp500_proxy", "2009-02-02", "2009-02-02", ("mul", 0.8), "2009-02-02", None),
    ],
)
def test_core_index_v2_publication_lags(
    column, stamp, run_end, operation, known_from, first_friday_seen
):
    frame = _v2_synthetic_frame()
    shifted = frame.copy()
    rows = (shifted.index >= pd.Timestamp(stamp, tz="UTC")) & (
        shifted.index <= pd.Timestamp(run_end, tz="UTC")
    )
    kind, amount = operation
    values = shifted[column].to_numpy(dtype=float).copy()
    values[rows] = values[rows] + amount if kind == "add" else values[rows] * amount
    shifted[column] = values

    known = pd.Timestamp(known_from, tz="UTC")
    before = frame.index < known
    _assert_v2_equal(
        calculate_core_index(frame).loc[before],
        calculate_core_index(shifted).loc[before],
    )

    # The lagged weekly input sees the change exactly when it is published.
    source_column = "spx" if column == "sp500_proxy" else column
    base_inputs = _core_index_v2_inputs(frame)[source_column]
    new_inputs = _core_index_v2_inputs(shifted)[source_column]
    differs = ~np.isclose(base_inputs, new_inputs, rtol=1e-12, atol=0.0, equal_nan=True)
    first_seen = base_inputs.index[differs].min() if differs.any() else None
    if first_friday_seen is None:
        assert first_seen is None
    else:
        assert first_seen == pd.Timestamp(first_friday_seen, tz="UTC")
        assert first_seen >= known


def test_core_index_v2_ignores_labels_and_derived_columns():
    frame = annotate_nber(_v2_synthetic_frame())
    frame["fed_score"] = 55.0
    frame["curve_score"] = 50.0
    frame["macro_strength"] = 60.0
    base = calculate_core_index(frame)

    rng = np.random.default_rng(11)
    noisy = frame.drop(columns=[c for c in frame.columns if c.startswith("nber_")])
    noisy["USREC"] = rng.integers(0, 2, len(noisy)).astype(float)
    noisy = annotate_nber(noisy)
    for name in ("fed_score", "curve_score", "macro_strength"):
        noisy[name] = rng.uniform(0.0, 100.0, len(noisy))
    changed = calculate_core_index(noisy)

    assert not noisy["nber_episode"].equals(frame["nber_episode"])
    _assert_v2_equal(base, changed)
    # The legacy v1 diagnostics do read fed/curve scores: the change was real.
    assert not np.allclose(
        base["macro_score"].to_numpy(dtype=float),
        changed["macro_score"].to_numpy(dtype=float),
        equal_nan=True,
    )


def test_core_index_v2_vocabulary_bands_and_flags():
    out = calculate_core_index(_v2_synthetic_frame())
    scored = out["core_index"].notna()
    assert scored.sum() > 8000
    for column in V2_STATE_COLUMNS:
        assert out[column].notna().equals(scored), column
    # The trend warning is known wherever the index is scored, and earlier.
    trend_known = out[TREND].notna()
    assert trend_known[scored].all() and trend_known.sum() > scored.sum()
    assert str(out[TREND].dtype) == "boolean"

    score = out.loc[scored, "core_index"]
    bucket = out.loc[scored, "core_index_bucket"].astype(object)
    severity = out.loc[scored, "core_index_severity"].astype(object)
    warning = out.loc[scored, "core_index_warning"].astype(bool)

    # Every bucket and severity occurs on this frame, and nothing else does.
    assert set(bucket) == set(V2_BANDS)
    assert set(severity) == set(CORE_INDEX_SEVERITIES)
    for name, (low, high) in V2_BANDS.items():
        assert score[bucket == name].between(low, high).all(), name
    assert (_core_index_bucket(out["core_index"])[scored].astype(object) == bucket).all()
    np.testing.assert_array_equal(out.loc[scored, "core_index_composite"], score + 50.0)

    assert warning[bucket == "bearish_warning"].all()
    assert not warning[bucket == "extreme_bearish"].any()
    assert ((severity == "none") == (~warning & (bucket != "extreme_bearish"))).all()
    # The early flag can warn while the bucket is still Balanced Growth.
    assert (warning & (bucket == "calm_bullish")).any()
    # The trend warning is its own flag: it disagrees with the v2 warning in
    # both directions on this path.
    trend = out.loc[scored, TREND].astype(bool)
    assert (trend & ~warning).any() and (warning & ~trend).any()


def test_core_index_v2_weekly_cadence_and_start():
    frame = _v2_synthetic_frame()
    first_daily = pd.Timestamp("1992-01-03", tz="UTC")  # a Friday
    labels = np.where(frame.index < first_daily, "M1125AUSM343NNBR", SP500_DAILY_SOURCE)
    frame["sp500_proxy_source"] = pd.array(labels, dtype="string")

    out = calculate_core_index_v2(frame)
    first = out["core_index"].first_valid_index()
    # 52 weekly returns need 53 Friday closes of daily-source equity.
    assert first == first_daily + pd.Timedelta(weeks=52)
    assert first.dayofweek == 4
    for column in V2_STATE_COLUMNS:
        assert out.loc[out.index < first, column].isna().all(), column
        assert out.loc[first:, column].notna().all(), column
    # The trend warning needs 40 Friday closes of daily-source equity.
    first_trend = out[TREND].first_valid_index()
    assert first_trend == first_daily + pd.Timedelta(weeks=CORE_INDEX_TREND_WEEKS - 1)
    assert out.loc[first_trend:, TREND].notna().all()
    assert set(out[TREND].dropna().astype(bool)) == {False, True}

    # Values change only on Fridays: Saturday to Thursday repeat the Friday.
    for column in CORE_INDEX_V2_COLUMNS:
        values = out.loc[first_trend if column == TREND else first :, column].astype(object)
        not_friday = values.index.dayofweek != 4
        assert (values[not_friday] == values.shift(1)[not_friday]).all(), column
    after = out.loc[first:]
    weekly_changes = after["core_index"].diff().fillna(0.0).ne(0.0)
    assert set(after.index[weekly_changes].dayofweek) == {4}
    trend = out.loc[first_trend:, TREND].astype(bool)
    flips = trend.ne(trend.shift(1, fill_value=bool(trend.iloc[0])))
    assert flips.any() and set(trend.index[flips].dayofweek) == {4}

    # A proxy from a monthly series is never scored.
    monthly = frame.copy()
    monthly["sp500_proxy_source"] = pd.array(["M1125AUSM343NNBR"] * len(frame), dtype="string")
    assert calculate_core_index_v2(monthly).isna().all().all()


def _v2_features(rows: list[dict]) -> pd.DataFrame:
    """Weekly feature rows for the state machine; unspecified values are calm."""
    defaults = {
        "spx": 110.0,
        "ma_long": 100.0,
        "ma_short": 100.0,
        "ma_stab": 100.0,
        "slope": 0.01,
        "hi52": 110.0,
        "dd52": 0.0,
        "vol13": 0.15,
        "vol_ratio": 1.0,
        "ext": 0.5,
        "credit_easing": True,
        "stress": 0,
    }
    index = pd.date_range("2001-01-05", periods=len(rows), freq="W-FRI", tz="UTC")
    return pd.DataFrame([{**defaults, **row} for row in rows], index=index)


def test_core_index_v2_fix1_stress_spell_ends_only_when_its_entry_conditions_clear():
    # A stress break (10% below the high, volatility 1.5x normal) while the
    # price is still above a rising 40-week average: the frozen candidate let
    # the spell end the next week and flipped bucket weekly (Nasdaq, 2000).
    stress_break = {"spx": 104.0, "hi52": 118.0, "dd52": -0.12, "vol_ratio": 1.6, "vol13": 0.30}
    features = _v2_features(
        [
            {},
            stress_break,
            stress_break,  # stress still on: the spell must hold
            {"spx": 108.0, "dd52": -0.08, "vol_ratio": 1.2},  # entry conditions clear
        ]
    )
    state, severity, warning = _core_index_v2_state(features)
    assert state.tolist() == ["NORMAL", "WARNING", "WARNING", "NORMAL"]
    assert warning.tolist() == [False, True, True, False]
    assert severity.tolist() == ["none", "correction", "correction", "none"]


@pytest.mark.parametrize(
    ("trend_breaks", "expected_last"),
    [(False, "NORMAL"), (True, "ACCUMULATE")],
)
def test_core_index_v2_fix2_accumulate_needs_a_trend_break_in_the_spell(
    trend_breaks, expected_last
):
    # A capitulation (20% down, volatility 1.5x) then stabilisation. Without
    # a broken 40-week trend in the spell it must not become Maximum Fear.
    features = _v2_features(
        [
            {},
            {"spx": 85.0, "ma_long": 90.0, "ma_stab": 90.0, "hi52": 113.0, "dd52": -0.25,
             "vol_ratio": 1.8, "vol13": 0.40},
            {"spx": 80.0, "ma_long": 88.0, "ma_stab": 88.0, "hi52": 113.0, "dd52": -0.29,
             "vol_ratio": 1.7, "vol13": 0.42, "slope": -0.005 if trend_breaks else 0.005},
            {"spx": 95.0, "ma_long": 90.0, "ma_stab": 90.0, "hi52": 113.0, "dd52": -0.16,
             "vol_ratio": 1.0, "vol13": 0.20},
        ]
    )
    state, severity, warning = _core_index_v2_state(features)
    assert state.tolist() == ["NORMAL", "WARNING", "WARNING", expected_last]
    assert warning.tolist() == [False, True, True, False]
    # The decline being bought keeps its class in Maximum Fear.
    assert severity[-1] == ("bear" if trend_breaks else "none")


# ---------------------------------------------------------------------------
# Trend warning: Friday close below the average of the last 40 Friday closes
# ---------------------------------------------------------------------------


def test_core_index_trend_warning_rule_on_weekly_closes():
    fridays = pd.date_range("2001-01-05", periods=45, freq="W-FRI", tz="UTC")
    closes = pd.Series(100.0, index=fridays)
    closes.iloc[40] = 99.0  # below the average of the last 40 (99.975)
    closes.iloc[41] = 101.0  # above the average of the last 40 (100.0)
    closes.iloc[42] = np.nan  # no daily close this Friday
    flags = _core_index_trend_warning(closes)

    assert str(flags.dtype) == "boolean"
    assert flags.index.equals(fridays)
    # 39 Fridays of warm-up; the 40th is an exact tie, which is not a warning;
    # a missing close is unknown and restarts the 40-close warm-up.
    assert _labels(flags) == [None] * 39 + [False, True, False, None, None, None]


def _trend_frame(seed: int = 3) -> tuple[pd.DataFrame, pd.Series, pd.Series]:
    """Daily calendar of 140 weeks: a weekly close set on each Friday and held
    through Thursday, with a source label per week. Weeks 0-9 and 80-82 carry
    the monthly Cowles label (no daily S&P source), the rest the daily ^GSPC
    label. Weeks 20-64 are flat, so the Fridays whose 40-week window is all
    flat are exact ties with their average."""
    rng = np.random.default_rng(seed)
    fridays = pd.date_range("2000-01-07", periods=140, freq="W-FRI", tz="UTC")
    closes = 100.0 * np.exp(np.cumsum(rng.normal(0.0, 0.03, len(fridays))))
    closes[20:65] = closes[20]
    labels = np.full(len(fridays), SP500_DAILY_SOURCE, dtype=object)
    labels[:10] = "M1125AUSM343NNBR"
    labels[80:83] = "M1125AUSM343NNBR"
    weekly = pd.DataFrame({"close": closes, "label": labels}, index=fridays)
    days = pd.date_range(fridays[0], fridays[-1] + pd.Timedelta(days=6), freq="D", tz="UTC")
    daily = weekly.reindex(days, method="ffill")
    frame = pd.DataFrame(
        {
            "sp500_proxy": daily["close"].to_numpy(dtype=float),
            "sp500_proxy_source": pd.array(daily["label"].tolist(), dtype="string"),
        },
        index=days,
    )
    frame.index.name = "date"
    return frame, weekly["close"], pd.Series(labels == SP500_DAILY_SOURCE, index=fridays)


def _expected_trend(closes: pd.Series, daily_source: pd.Series) -> list:
    """The rule by hand, in exact arithmetic on the raw Friday closes."""
    weeks = CORE_INDEX_TREND_WEEKS
    expected = []
    for i in range(len(closes)):
        low = i - weeks + 1
        if low < 0 or not daily_source.iloc[low : i + 1].all():
            expected.append(None)
            continue
        window = [Fraction(float(value)) for value in closes.iloc[low : i + 1]]
        expected.append(Fraction(float(closes.iloc[i])) < sum(window) / weeks)
    return expected


def test_core_index_trend_warning_exact_definition_on_a_synthetic_series():
    frame, closes, daily_source = _trend_frame()
    expected = _expected_trend(closes, daily_source)
    assert expected.count(None) == 10 + 39 + 3 + 39  # no source, warm-up, gap, warm-up
    assert expected[59:65] == [False] * 6  # flat windows: ties are not warnings
    assert True in expected and False in expected[65:]

    out = calculate_core_index_v2(frame)
    trend = out[TREND]
    assert _labels(trend.loc[closes.index]) == expected
    assert trend.first_valid_index() == closes.index[10 + CORE_INDEX_TREND_WEEKS - 1]
    # Each Friday's decision holds Saturday to Thursday.
    held = pd.Series(expected, index=closes.index, dtype=object).reindex(frame.index, method="ffill")
    assert _labels(trend) == held.where(held.notna(), None).tolist()
    # The Core Index itself is not ready on most of these Fridays (it needs
    # 53 closes): the two flags have separate warm-ups.
    assert out["core_index"].first_valid_index() > trend.first_valid_index()


def test_core_index_trend_warning_no_look_ahead_on_truncated_data():
    frame, closes, _ = _trend_frame(seed=5)
    full = calculate_core_index_v2(frame)[TREND]
    first = full.first_valid_index()
    # every day of the two weeks around the end of the warm-up, then random days
    cuts = list(frame.loc[first - pd.Timedelta(days=7) : first + pd.Timedelta(days=7)].index)
    rng = np.random.default_rng(13)
    cuts += list(frame.index[np.sort(rng.choice(len(frame) - 1, size=20, replace=False))])
    for cut in cuts:
        part = calculate_core_index_v2(frame.loc[:cut])[TREND]
        assert _labels(part) == _labels(full.loc[:cut]), cut


def test_core_index_trend_warning_reads_only_the_equity_close():
    frame = _v2_synthetic_frame()
    base = calculate_core_index_v2(frame)
    rng = np.random.default_rng(17)
    noisy = frame.copy()
    for column in CORE_INDEX_INPUT_LAGS:
        noisy[column] = noisy[column] * rng.uniform(0.5, 2.0, len(noisy))
    changed = calculate_core_index_v2(noisy)
    equity_only = calculate_core_index_v2(frame[["sp500_proxy", "sp500_proxy_source"]])

    assert _labels(changed[TREND]) == _labels(base[TREND])
    assert _labels(equity_only[TREND]) == _labels(base[TREND])
    # The stress inputs did move the Core Index itself.
    assert any(
        _labels(changed[column]) != _labels(base[column])
        for column in ("core_index_severity", "core_index_warning")
    )


def test_committed_artifact_core_index_in_sync():
    stored = pd.read_parquet(ARTIFACT, columns=V2_INPUTS + list(CORE_INDEX_V2_COLUMNS))
    fresh = calculate_core_index_v2(stored[V2_INPUTS])
    _assert_v2_equal(stored, fresh)

    meta = json.loads(ARTIFACT_META.read_text(encoding="utf-8"))
    block = meta["core_index"]
    assert block["version"] == CORE_INDEX_VERSION == "core-index-v2"
    assert meta["data_version"] == hashlib.sha256(ARTIFACT.read_bytes()).hexdigest()[:12]
    assert CORE_INDEX_NOTE in meta["notes"]
    assert not any("40/30/30" in note for note in meta["notes"])

    scored = stored["core_index"].dropna()
    assert scored.index[0] == pd.Timestamp("1928-12-28", tz="UTC")
    assert block["first_scored"] == "1928-12-28"
    latest = block["latest"]
    assert latest["date"] == scored.index[-1].date().isoformat()
    assert latest["score"] == round(float(scored.iloc[-1]), 2)
    assert latest["bucket"] == stored["core_index_bucket"].iloc[-1]
    assert latest["severity"] == stored["core_index_severity"].iloc[-1]
    assert latest["warning"] == bool(stored["core_index_warning"].iloc[-1])
    assert latest["trend_warning"] == bool(stored[TREND].iloc[-1])
    assert pd.Timestamp(latest["signal_date"]).dayofweek == 4
    assert set(meta["frame"]["columns_list"]) >= set(CORE_INDEX_V2_COLUMNS)
    columns = meta["frame"]["columns_list"]
    assert columns.index(TREND) == columns.index("core_index_warning") + 1

    # The trend warning: stored as a nullable boolean, known from the 40th
    # daily S&P Friday, described and measured in the metadata.
    assert str(stored[TREND].dtype) == "boolean"
    assert stored[TREND].first_valid_index() == pd.Timestamp("1928-09-28", tz="UTC")
    trend_block = block["trend_warning"]
    assert trend_block["column"] == TREND
    assert trend_block["rule"] == CORE_INDEX_TREND_RULE
    assert trend_block["weeks"] == CORE_INDEX_TREND_WEEKS == 40
    assert trend_block["first_value"] == "1928-09-28"
    assert trend_block["fitted"] is False and trend_block["changes_core_index"] is False
    assert trend_block["record"] == CORE_INDEX_TREND_RECORD
    record = trend_block["record"]
    # The record names the artifact and the weeks it was measured on (a later
    # re-ingestion keeps it as a dated record until it is measured again).
    measured = record["measured_on"]
    assert len(measured["data_version"]) == 12 and measured["first_week"] == "1928-09-28"
    assert measured["last_week"] <= latest["signal_date"]
    falls = record["falls_of_20pct_or_more"]
    assert falls["count"] == len(falls["falls"]) == falls["on_within_first_20pct"] + falls["not_within_first_20pct"]
    assert set(record["false_alarms_per_decade"]) == {"1928-1971", "1971-1989", "1990-2026", "all"}


def test_committed_artifact_trend_warning_is_the_40_friday_rule():
    # Checked on the raw daily S&P closes, not on the chained series the
    # production code reads. Raw closes are comparable inside one source, so
    # the windows checked are 40 Fridays on the daily ^GSPC source (every
    # window since 1928 in this artifact).
    stored = pd.read_parquet(ARTIFACT, columns=["sp500_proxy", "sp500_proxy_source", TREND])
    fridays = stored[stored.index.dayofweek == 4]
    weeks = CORE_INDEX_TREND_WEEKS
    close = fridays["sp500_proxy"].astype(float)
    daily = fridays["sp500_proxy_source"].astype(object).eq(SP500_DAILY_SOURCE)
    one_source = daily.astype(float).rolling(weeks, min_periods=weeks).sum().eq(weeks)
    average = close.rolling(weeks, min_periods=weeks).mean()
    assert one_source.sum() > 5000
    assert _labels(fridays.loc[one_source, TREND]) == (close < average)[one_source].tolist()
    # Unknown until the 40th daily-source Friday (1928-09-28).
    first_daily = fridays.index.get_loc(daily.idxmax())
    assert stored[TREND].first_valid_index() == fridays.index[first_daily + weeks - 1]
    # The share of Fridays with the warning on: about a third.
    share = fridays.loc[one_source, TREND].astype(bool).mean()
    assert 0.25 < share < 0.40


# Friday readings of the committed artifact (data_version 403e16a6f64d, S&P
# 500 daily from 1927-12-30), each also held through the following Thursday.
# Re-derive after any re-ingestion: latest-vintage FRED revisions can move
# them; test_committed_artifact_core_index_in_sync is the real guard.
CORE_INDEX_V2_KNOWN_READINGS = (
    # date, bucket, severity, warning, score
    ("1928-12-28", "calm_bullish", "none", False, 22.52),  # first scored Friday
    ("1929-09-13", "strong_bullish", "none", False, 25.11),  # Trim at the 1929 top
    ("1929-11-01", "calm_bullish", "none", False, 10.29),  # the 1929 crash missed
    ("1929-11-08", "bearish_warning", "bear", True, -1.00),
    ("1930-04-04", "extreme_bearish", "crash", False, -25.00),  # too early: -83% to come
    ("1932-07-08", "bearish_warning", "crash", True, -24.00),  # the 1932 low
    ("1987-10-09", "calm_bullish", "none", False, 21.39),
    ("1987-10-16", "bearish_warning", "bear", True, -1.00),  # Friday before Black Monday
    ("1987-10-23", "bearish_warning", "crash", True, -5.90),
    ("2000-03-24", "calm_bullish", "none", False, 11.89),  # S&P 500 peak week
    ("2000-09-29", "calm_bullish", "bear", True, 8.93),  # early flag while Balanced
    ("2007-08-17", "calm_bullish", "bear", True, 9.88),  # flag before the 2007 peak
    ("2008-01-18", "bearish_warning", "bear", True, -1.00),
    ("2009-06-05", "extreme_bearish", "crash", False, -28.35),
    ("2020-02-21", "calm_bullish", "none", False, 20.92),
    ("2020-02-28", "bearish_warning", "bear", True, -1.00),
    ("2020-06-12", "bearish_warning", "crash", True, -1.00),  # a one-week flicker
    ("2022-03-18", "calm_bullish", "bear", True, 5.39),
    ("2026-10-23", "calm_bullish", "none", False, 15.76),
)


def test_core_index_v2_known_readings():
    frame = pd.read_parquet(ARTIFACT, columns=list(CORE_INDEX_V2_COLUMNS))
    for day, bucket, severity, warning, score in CORE_INDEX_V2_KNOWN_READINGS:
        friday = pd.Timestamp(day, tz="UTC")
        assert friday.dayofweek == 4, day
        row = frame.loc[friday]
        assert row["core_index_bucket"] == bucket, day
        assert row["core_index_severity"] == severity, day
        assert bool(row["core_index_warning"]) is warning, day
        assert row["core_index"] == pytest.approx(score, abs=0.005), day
        week = frame.loc[friday : friday + pd.Timedelta(days=6)]
        for column in CORE_INDEX_V2_COLUMNS:
            assert _labels(week[column]) == [row[column]] * len(week), (day, column)


# Friday trend-warning readings of the committed artifact (data_version
# 8c3b382a9b5b), each held through the following Thursday. Re-derive after
# any re-ingestion, like the readings above.
CORE_INDEX_TREND_KNOWN_READINGS = (
    # date, trend warning (None = not known yet)
    ("1928-09-21", None),  # warm-up: 39 daily S&P Fridays so far
    ("1928-09-28", False),  # first known Friday
    ("1929-10-18", False),
    ("1929-10-25", True),  # the Friday before the 28-29 October 1929 crash
    ("1932-08-12", True),
    ("1932-08-19", False),  # off before the 1932 peak, the Core Index still warning
    ("1987-10-09", False),
    ("1987-10-16", True),  # the Friday before Black Monday
    ("1999-10-15", True),
    ("2000-03-24", False),  # S&P 500 peak week
    ("2007-08-03", True),  # before the 2007 peak
    ("2020-02-21", False),
    ("2020-02-28", True),
    ("2020-06-12", False),  # off while the Core Index still warns
    ("2022-01-14", False),
    ("2022-01-21", True),  # on while the Core Index is calm
    ("2026-10-23", False),
)


def test_core_index_trend_warning_known_readings():
    frame = pd.read_parquet(ARTIFACT, columns=[TREND])
    for day, expected in CORE_INDEX_TREND_KNOWN_READINGS:
        friday = pd.Timestamp(day, tz="UTC")
        assert friday.dayofweek == 4, day
        week = frame.loc[friday : friday + pd.Timedelta(days=6), TREND]
        assert _labels(week) == [expected] * len(week), day


def _write_v1_style_artifact(directory: Path) -> tuple[pd.DataFrame, bytes]:
    """A small artifact as the pipeline wrote it before v2 (v1 Core Index
    columns, CRLF metadata with the v1 note)."""
    frame = _v2_synthetic_frame().loc[:"1996-12-31"]
    frame["macro_strength"] = 55.0
    v1 = calculate_core_index(frame).drop(
        columns=["core_index_severity", "core_index_warning", TREND]
    )
    v1["core_index"] = 10.0
    v1["core_index_composite"] = 60.0
    v1["core_index_bucket"] = pd.array(["calm_bullish"] * len(v1), dtype="string")
    frame = frame.join(v1)
    frame.to_parquet(directory / "macro_regime_history.parquet", engine="pyarrow", compression="snappy", index=True)
    meta = {
        "data_version": "old",
        "generated_at": "2026-01-01T00:00:00+00:00",
        "pipeline_version": "phase12-v1",
        "frame": {"rows": len(frame), "columns": len(frame.columns), "columns_list": list(frame.columns)},
        "core_index": {"version": "core-index-v1", "weights": {"macro": 0.4}},
        "notes": ["First note.", "Core Index is a descriptive 40/30/30 composite.", "Last note."],
    }
    raw = json.dumps(meta, indent=2, sort_keys=True).replace("\n", "\r\n").encode("utf-8")
    (directory / "macro_regime_history.meta.json").write_bytes(raw)
    return frame, raw


def test_recompute_core_index_rewrites_only_the_v2_columns(tmp_path):
    from scripts.recompute_core_index import PIPELINE_VERSION, main, recompute

    frame, _ = _write_v1_style_artifact(tmp_path)
    assert main(["--artifact-dir", str(tmp_path), "--check"]) == 1

    report = recompute(tmp_path)
    assert report["written"] is True and report["parquet_written"] is True
    assert report["stale_columns"] == [] and report["in_sync"] is True
    assert report["added"] == ["core_index_severity", "core_index_warning", TREND]
    assert report["replaced"] == ["core_index", "core_index_composite", "core_index_bucket"]
    assert report["untouched_columns_arrow_equal"] == len(frame.columns) - 3 + 1  # + index
    assert sorted(report["existing_columns_changed"]) == sorted(report["replaced"])

    new = pd.read_parquet(tmp_path / "macro_regime_history.parquet")
    columns = list(new.columns)
    bucket = columns.index("core_index_bucket")
    assert columns[bucket + 1 : bucket + 4] == ["core_index_severity", "core_index_warning", TREND]
    assert str(new["core_index_warning"].dtype) == "boolean"
    assert str(new[TREND].dtype) == "boolean"
    for column in frame.columns:
        if column not in CORE_INDEX_V2_COLUMNS:
            pd.testing.assert_series_equal(
                new[column], frame[column], check_dtype=False, check_freq=False
            )
    _assert_v2_equal(new, calculate_core_index_v2(frame))

    raw = (tmp_path / "macro_regime_history.meta.json").read_bytes()
    assert b"\r\n" in raw and raw.count(b"\n") == raw.count(b"\r\n")
    meta = json.loads(raw)
    assert meta["data_version"] == report["data_version"] != "old"
    assert meta["data_version"] == hashlib.sha256(
        (tmp_path / "macro_regime_history.parquet").read_bytes()
    ).hexdigest()[:12]
    assert meta["pipeline_version"] == PIPELINE_VERSION == "phase12-v2"
    assert meta["generated_at"] == "2026-01-01T00:00:00+00:00"
    assert meta["notes"] == ["First note.", CORE_INDEX_NOTE, "Last note."]
    assert meta["frame"]["columns"] == len(frame.columns) + 3
    assert meta["core_index"]["version"] == "core-index-v2"
    assert meta["core_index"]["recomputed_from_data_version"] == report["previous_data_version"]
    assert meta["core_index"]["trend_warning"]["rule"] == CORE_INDEX_TREND_RULE
    assert meta["core_index"]["latest"]["trend_warning"] == bool(new[TREND].iloc[-1])

    # In sync now: --check passes and a second run changes nothing.
    assert main(["--artifact-dir", str(tmp_path), "--check"]) == 0
    before = (tmp_path / "macro_regime_history.parquet").read_bytes()
    assert recompute(tmp_path)["written"] is False
    assert (tmp_path / "macro_regime_history.parquet").read_bytes() == before


def test_recompute_core_index_adds_the_trend_warning_and_keeps_every_other_byte(tmp_path):
    from scripts.recompute_core_index import main, recompute

    # An artifact as the v2 pipeline wrote it before the trend warning.
    frame = _v2_synthetic_frame().loc[:"1999-12-31"]
    frame["macro_strength"] = 55.0
    frame = frame.join(calculate_core_index(frame).drop(columns=[TREND]))
    parquet = tmp_path / "macro_regime_history.parquet"
    frame.to_parquet(parquet, engine="pyarrow", compression="snappy", index=True)
    old_bytes = parquet.read_bytes()
    old_version = hashlib.sha256(old_bytes).hexdigest()[:12]
    meta = {
        "data_version": old_version,
        "generated_at": "2026-01-01T00:00:00+00:00",
        "pipeline_version": "phase12-v2",
        "frame": {"rows": len(frame), "columns": len(frame.columns), "columns_list": list(frame.columns)},
        "core_index": {"version": "core-index-v2", "recomputed_at": "2026-02-02T00:00:00+00:00",
                       "recomputed_from_data_version": "older"},
        "notes": [CORE_INDEX_NOTE],
    }
    meta_path = tmp_path / "macro_regime_history.meta.json"
    meta_path.write_bytes(json.dumps(meta, indent=2, sort_keys=True).replace("\n", "\r\n").encode("utf-8"))
    assert main(["--artifact-dir", str(tmp_path), "--check"]) == 1

    report = recompute(tmp_path)
    assert report["stale_columns"] == [] and report["parquet_written"] is True
    assert report["added"] == [TREND] and report["replaced"] == []
    # Every column the artifact already had (the five v2 columns included)
    # keeps its values and its encoded bytes.
    assert report["existing_columns"] == len(frame.columns) + 1  # + index
    assert report["existing_columns_changed"] == []
    assert report["existing_columns_reencoded"] == []

    new = pd.read_parquet(parquet)
    columns = list(new.columns)
    assert columns == [*frame.columns, TREND]
    assert str(new[TREND].dtype) == "boolean"
    _assert_v2_equal(new, calculate_core_index_v2(frame))
    written = json.loads(meta_path.read_bytes())
    assert written["data_version"] == hashlib.sha256(parquet.read_bytes()).hexdigest()[:12] != old_version
    assert written["frame"]["columns"] == len(frame.columns) + 1
    assert written["core_index"]["recomputed_from_data_version"] == old_version
    assert written["core_index"]["trend_warning"]["first_value"] == (
        new[TREND].first_valid_index().date().isoformat()
    )

    # A stale metadata block alone is rewritten without touching the parquet.
    parquet_bytes = parquet.read_bytes()
    written["core_index"].pop("trend_warning")
    meta_path.write_bytes(json.dumps(written, indent=2, sort_keys=True).replace("\n", "\r\n").encode("utf-8"))
    assert main(["--artifact-dir", str(tmp_path), "--check"]) == 1
    report = recompute(tmp_path)
    assert report["written"] is True and report["parquet_written"] is False
    assert report["updated_meta_keys"] == ["core_index"]
    assert parquet.read_bytes() == parquet_bytes
    repaired = json.loads(meta_path.read_bytes())
    assert repaired["core_index"]["trend_warning"]["rule"] == CORE_INDEX_TREND_RULE
    assert repaired["core_index"]["recomputed_at"] == written["core_index"]["recomputed_at"]
    assert repaired["data_version"] == written["data_version"]
    assert main(["--artifact-dir", str(tmp_path), "--check"]) == 0
