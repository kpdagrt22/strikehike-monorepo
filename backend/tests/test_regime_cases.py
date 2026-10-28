"""Tests for the Convergence case catalogue (regime.cases) and its routes."""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from regime import cases  # noqa: E402
from regime import cases_router  # noqa: E402
from regime.case_schemas import CasePathResponse, CasesResponse  # noqa: E402

COLUMN = {key: spec.column for key, spec in cases.SERIES_SPECS.items()}
CASE_KEYS = {
    "id", "kind", "name", "short_name", "name_source", "aka", "region", "series", "peak", "trough",
    "recovery", "recovery_status", "depth_pct", "days_to_trough", "days_to_recovery", "latest",
    "lower_low", "core_index", "macro_strength", "sky", "series_available", "recessions", "events",
    "description", "flags",
}


# ---------------------------------------------------------------------------
# Synthetic artifacts
# ---------------------------------------------------------------------------


def _ts(value: str) -> pd.Timestamp:
    return pd.Timestamp(value, tz="UTC")


def _piecewise(index: pd.DatetimeIndex, knots: list[tuple[str, float]]) -> pd.Series:
    """Linear path through (date, value) knots; NaN outside the knots."""
    origin = index[0]
    x = np.asarray((index - origin).days, dtype="float64")
    xk = np.array([(_ts(day) - origin).days for day, _ in knots], dtype="float64")
    yk = np.array([float(value) for _, value in knots])
    values = np.interp(x, xk, yk)
    values[(x < xk[0]) | (x > xk[-1])] = np.nan
    return pd.Series(values, index=index)


def _weekdays(series: pd.Series) -> pd.Series:
    """Weekday values forward-filled over weekends, as in the parquet."""
    trading = series.where(series.index.dayofweek < 5)
    return trading.ffill().where(series.notna())


def _monthly(index: pd.DatetimeIndex, first: str, values: list[float], until: str) -> pd.Series:
    months = pd.date_range(first, periods=len(values), freq="MS", tz="UTC")
    series = pd.Series(np.nan, index=index)
    series.loc[months] = values
    series = series.ffill()
    series[(series.index < months[0]) | (series.index > _ts(until))] = np.nan
    return series


def _source(values: pd.Series, label: str) -> pd.Series:
    out = pd.Series(pd.NA, index=values.index, dtype="string")
    out[values.notna()] = label
    return out


COWLES = [
    100, 104, 108, 112, 116, 120,  # peak 120 on 1998-06-01
    110, 101, 98, 96,  # low 96 on 1998-10-01 (-20.0%)
    100, 105, 110, 115, 119, 121,  # back above 120 on 1999-04-01
    122, 123, 124, 125, 126, 127, 128, 129, 130, 131, 132, 133,
    134, 135, 136, 137, 138, 139, 140, 141,
]


def _frame(*, gap: bool = False) -> pd.DataFrame:
    index = pd.date_range("1998-01-01", "2013-12-31", freq="D", tz="UTC")
    frame = pd.DataFrame(index=index)
    if gap:
        # The second Cowles decline is still open when the series stops on
        # 1 Dec 1999; the S&P resumes on 2 Jul 2001 after a run of missing days.
        months = [100, 110, 120, 125, 128, 130, 125, 120, 112, 106, 103, 101,
                  104, 112, 118, 124, 128, 130, 126, 120, 112, 106, 103, 100]
        cowles = _monthly(index, "1998-01-01", months, "1999-12-01")
        sp = _weekdays(_piecewise(index, [("2001-07-02", 1000), ("2004-12-31", 1400)]))
    else:
        cowles = _monthly(index, "1998-01-01", COWLES, "2001-01-01")
        sp = _weekdays(_piecewise(index, [
            ("2001-01-02", 1000), ("2007-06-15", 1500), ("2008-11-20", 800),
            ("2012-03-15", 1600), ("2013-12-31", 1300),
        ]))
    frame["sp500_proxy"] = cowles.fillna(sp)
    source = _source(cowles, "M1125AUSM343NNBR")
    source[cowles.isna() & sp.notna()] = "YAHOO_FINANCE_GSPC"
    frame["sp500_proxy_source"] = source

    nifty = _weekdays(_piecewise(index, [
        ("2007-09-17", 5000), ("2008-01-08", 6200), ("2008-10-27", 2500),
        ("2010-11-09", 6300), ("2013-12-31", 7000),
    ]))
    frame["nifty_proxy"], frame["nifty_proxy_source"] = nifty, _source(nifty, "YAHOO_FINANCE_NSEI")
    btc = _piecewise(index, [
        ("2010-08-18", 0.06), ("2010-11-08", 0.5), ("2010-12-11", 0.2), ("2011-01-31", 0.6),
        ("2011-06-11", 30.0), ("2011-11-22", 2.0), ("2013-03-02", 40.0), ("2013-12-31", 100.0),
    ])
    frame["btc_proxy"], frame["btc_proxy_source"] = btc, _source(btc, "BLOCKCHAIN_COM_MARKET_PRICE")
    month_index = pd.date_range("1998-01-01", "2013-12-01", freq="MS", tz="UTC")
    gold_knots = _piecewise(month_index, [
        ("1998-01-01", 300), ("2008-03-01", 900), ("2008-10-01", 600), ("2011-09-01", 1800), ("2013-12-01", 1400),
    ])
    gold = _monthly(index, "1998-01-01", gold_knots.tolist(), "2013-12-31")
    frame["gold_proxy"], frame["gold_proxy_source"] = gold, _source(gold, "WORLD_BANK_LBMA_GOLD")
    bonds = _weekdays(_piecewise(index, [("1998-01-02", 100), ("2013-12-31", 200)]))
    frame["bond_proxy"], frame["bond_proxy_source"] = bonds, _source(bonds, "UST10Y_TOTAL_RETURN_PROXY")

    frame["nber_recession"] = 0
    frame.loc["2008-01-01":"2009-06-30", "nber_recession"] = 1
    core = pd.Series(np.nan, index=index)
    core.loc["2003-01-01":] = np.linspace(30.0, -30.0, len(core.loc["2003-01-01":]))
    frame["core_index"] = core
    bucket = pd.Series(pd.NA, index=index, dtype="string")
    bucket[core >= 25] = "strong_bullish"
    bucket[(core >= 0) & (core < 25)] = "calm_bullish"
    bucket[(core < 0) & (core > -25)] = "bearish_warning"
    bucket[core <= -25] = "extreme_bearish"
    frame["core_index_bucket"] = bucket
    strength = pd.Series(np.nan, index=index)
    strength.loc["1999-01-01":] = 55.0
    frame["macro_strength"] = strength
    coverage = pd.Series(np.nan, index=index)
    coverage.loc["1999-01-01":"2000-12-31"] = 0.7
    coverage.loc["2001-01-01":] = 1.0
    frame["macro_strength_coverage"] = coverage
    state = pd.Series(pd.NA, index=index, dtype="string")
    state[strength.notna()] = "neutral"
    frame["regime_state"] = state
    return frame


def _write(tmp_path: Path, frame: pd.DataFrame) -> tuple[Path, Path, Path]:
    artifact = tmp_path / "macro_regime_history.parquet"
    frame.to_parquet(artifact, engine="pyarrow", compression="snappy")
    meta = tmp_path / "macro_regime_history.meta.json"
    meta.write_text(json.dumps({"data_version": "test-cases-v1"}), encoding="utf-8")
    events = tmp_path / "historical_events.json"
    events.write_text(
        json.dumps(
            {
                "events": [
                    {"date": "2008-09-15", "name": "Synthetic finance event", "category": "Finance"},
                    {"date": "2008-12-01", "name": "After the low", "category": "Finance"},
                    {"date": "2008-09-01", "name": "Not finance", "category": "Politics"},
                ]
            }
        ),
        encoding="utf-8",
    )
    return artifact, meta, events


@pytest.fixture
def store(tmp_path) -> cases.CaseStore:
    return cases.CaseStore(*_write(tmp_path, _frame()))


def _by_id(catalogue: dict) -> dict[str, dict]:
    return {case["id"]: case for case in catalogue["cases"]}


def _small_frame(values: dict[str, list[tuple[str, float]]], sources: dict[str, list[str]] | None = None) -> pd.DataFrame:
    """A daily frame from exact (date, value) observations, forward-filled."""
    index = pd.date_range("2000-01-01", "2003-12-31", freq="D", tz="UTC")
    frame = pd.DataFrame(index=index)
    for column, points in values.items():
        series = pd.Series(np.nan, index=index)
        for day, value in points:
            series[_ts(day)] = value
        last = _ts(points[-1][0])
        frame[column] = series.ffill().where(series.index <= last)
        if sources and column in sources:
            labels = pd.Series(pd.NA, index=index, dtype="string")
            for (day, _), label in zip(points, sources[column]):
                labels[_ts(day)] = label
            frame[column.replace("_proxy", "_proxy_source")] = labels.ffill().where(frame[column].notna())
    return frame


def _business_days(start: str, values: list[float]) -> list[tuple[str, float]]:
    days = pd.bdate_range(start, periods=len(values))
    return [(day.date().isoformat(), value) for day, value in zip(days, values)]


# ---------------------------------------------------------------------------
# Pure functions
# ---------------------------------------------------------------------------


def _obs(values: list[float]) -> pd.Series:
    return pd.Series(values, index=pd.bdate_range("2020-01-01", periods=len(values), tz="UTC"), dtype="float64")


def test_detect_episodes_peak_trough_and_recovery():
    obs = _obs([100, 110, 120, 90, 100, 125])
    episodes = cases.detect_episodes(obs, 0.15, 0.50)
    assert len(episodes) == 1
    episode = episodes[0]
    assert (episode.peak, episode.trough, episode.close) == (obs.index[2], obs.index[3], obs.index[5])
    assert episode.closed_by == "recovery"
    assert cases.recovery_date(obs, episode) == obs.index[5]


def test_detect_episodes_takes_last_equal_high_and_first_equal_low():
    obs = _obs([100, 120, 120, 100, 90, 90, 130])
    episode = cases.detect_episodes(obs, 0.15, 0.50)[0]
    assert episode.peak == obs.index[2]
    assert episode.trough == obs.index[4]


def test_rebound_close_then_deeper_low_sets_lower_low():
    points = _business_days("2001-03-05", [100, 60, 91, 95, 50, 101])
    catalogue = cases.build_case_catalogue(_small_frame({"nifty_proxy": points}), {}, [], [])
    nifty = [case for case in catalogue["cases"] if case["kind"] == "india_equity"]
    assert len(nifty) == 2
    first, second = nifty
    assert (first["peak"], first["trough"]) == (points[0][0], points[1][0])
    assert first["recovery"] == points[5][0]  # first regain of 100, after the deeper low
    assert first["lower_low"] == {"date": points[4][0], "pct_from_peak": -50.0}
    assert (second["peak"], second["trough"], second["recovery"]) == (points[3][0], points[4][0], points[5][0])
    assert second["lower_low"] is None


def test_window_stats_is_time_ordered():
    index = pd.date_range("2021-01-01", periods=3, freq="D", tz="UTC")
    frame = pd.DataFrame({"asset": [50.0, 100.0, 80.0]}, index=index)
    stats = cases.window_stats(frame, "2021-01-01", "2021-01-03", "asset")
    assert stats["drawdown_pct"] == -20.0  # never -50.0 (min before max)
    assert stats["peak_date"] == "2021-01-02" and stats["trough_date"] == "2021-01-03"
    assert stats["peak_date"] < stats["trough_date"]
    rising = pd.DataFrame({"asset": [1.0, 2.0, 3.0]}, index=index)
    assert cases.window_stats(rising, "2021-01-01", "2021-01-03", "asset")["drawdown_pct"] == 0.0
    assert cases.window_stats(frame, "2030-01-01", "2030-12-31", "asset") is None


def test_source_splice_is_chained_not_a_decline():
    nasdaq = _business_days("2000-01-03", list(np.linspace(5000.0, 5250.0, 300)))
    sp500 = _business_days("2001-02-26", list(np.linspace(2133.0, 2200.0, 120)))
    frame = _small_frame(
        {"sp500_proxy": nasdaq + sp500},
        {"sp500_proxy": ["NASDAQCOM"] * len(nasdaq) + ["SP500"] * len(sp500)},
    )
    context = cases.build_context(frame, {}, [], [])
    assert [c for c in context.catalogue["cases"] if c["kind"] == "us_equity"] == []  # raw -59% is a splice
    path = cases.build_case_path(context, "today", "sp500", -365, "latest")
    assert path["splices"] == [
        {"d": (_ts(sp500[0][0]) - _ts(path["t0"])).days, "from": "NASDAQCOM", "to": "SP500"}
    ]
    assert max(abs(b - a) for a, b in zip(path["v"], path["v"][1:])) < 1.0  # no jump at the splice


def test_series_gap_ends_the_path_and_the_recovery(tmp_path):
    store = cases.CaseStore(*_write(tmp_path, _frame(gap=True)))
    catalogue = store.cases()
    assert catalogue["coverage"]["equity_gap"] == {"start": "1999-12-02", "end": "2001-07-01"}
    us = [case for case in catalogue["cases"] if case["kind"] == "us_equity"]
    blocked = [case for case in us if case["recovery_status"] == "unobservable"]
    assert len(blocked) == 1
    case = blocked[0]
    assert case["flags"]["recovery_unobservable"] and case["recovery"] is None and case["latest"] is None
    assert "recovery not observable (no US stock data Dec 1999 – Jul 2001)" in case["description"]
    path = store.case_path(case["id"])
    assert path["ends"] == "series_gap"
    assert path["d"][-1] == (_ts("1999-12-01") - _ts(case["peak"])).days
    today = store.case_path("today", "sp500", 0, "peak")
    assert today["t0"] >= "2001-07-02"  # the current era begins after the gap


# ---------------------------------------------------------------------------
# Catalogue contract on the synthetic artifact
# ---------------------------------------------------------------------------


def test_cases_contract(store):
    catalogue = store.cases()
    CasesResponse.model_validate(catalogue)
    assert catalogue["version"] == "regime-cases-v1"
    assert catalogue["data_version"] == "test-cases-v1"
    assert catalogue["as_of"] == "2013-12-31"
    ids = [case["id"] for case in catalogue["cases"]]
    assert len(ids) == len(set(ids))
    assert {kind["key"] for kind in catalogue["kinds"]} == set(cases.KIND_RULES)
    assert all(set(case) == CASE_KEYS for case in catalogue["cases"])
    assert "us_recession" not in {case["kind"] for case in catalogue["cases"]}
    assert catalogue["recessions"] == [
        {"id": "nber-2007-12", "name": "Great Recession", "start_month": "2007-12", "end_month": "2009-06"}
    ]
    counts = catalogue["counts"]
    assert (counts["us_equity"], counts["india_equity"], counts["bitcoin"], counts["gold"], counts["treasury"]) == (
        3, 1, 1, 1, 0
    )
    assert counts["total"] == len(catalogue["cases"]) == 6
    assert cases.validate_catalogue(store.context(), require_pairs=False) == []

    by_id = _by_id(catalogue)
    monthly = by_id["us-equity-1998-06"]
    assert (monthly["peak"], monthly["trough"], monthly["recovery"]) == ("1998-06-01", "1998-10-01", "1999-04-01")
    assert monthly["depth_pct"] == -20.0 and monthly["flags"]["month_precise"]
    assert monthly["name"] == "US stock decline of 1998" and monthly["series"]["source"] == "M1125AUSM343NNBR"
    assert monthly["description"] == "Cowles index fell 20.0% from Jun 1998 to Oct 1998; back at the peak in Apr 1999."

    gfc_like = by_id["us-equity-2007-06"]
    assert (gfc_like["peak"], gfc_like["trough"]) == ("2007-06-15", "2008-11-20")
    assert gfc_like["name"] == "S&P 500 decline of 2007–08" and gfc_like["short_name"] == "S&P 2007–08"
    assert gfc_like["recessions"] == ["nber-2007-12"]
    assert [event["name"] for event in gfc_like["events"]] == ["Synthetic finance event"]
    assert gfc_like["series_available"] == ["sp500", "gold", "bonds"]  # Nifty starts after this peak
    assert gfc_like["core_index"]["at_peak_date"] == "2007-06-15"
    assert gfc_like["macro_strength"]["at_trough"] == {"value": 55.0, "regime_state": "neutral", "coverage": 1.0}

    open_case = by_id["us-equity-2012-03"]
    assert open_case["recovery_status"] == "not_recovered" and open_case["flags"]["open"]
    assert open_case["latest"]["date"] == catalogue["coverage"]["series_last_obs"]["sp500"] == "2013-12-31"
    assert open_case["description"].endswith("not back at the peak by 31 Dec 2013.")

    nifty = by_id["nifty-2008-01"]
    assert nifty["name"] == "Global Financial Crisis (Nifty 50)" and nifty["name_source"] == "curated"
    assert [case["peak"] for case in catalogue["cases"] if case["kind"] == "bitcoin"] == ["2011-06-11"]

    raw = pd.read_parquet(store.artifact_path)
    for case in catalogue["cases"]:
        levels = pd.to_numeric(raw[COLUMN[case["series"]["key"]]], errors="coerce")
        peak, trough = _ts(case["peak"]), _ts(case["trough"])
        assert case["depth_pct"] == round((levels[trough] / levels[peak] - 1.0) * 100.0, 1)
        assert case["days_to_trough"] == (trough - peak).days
        if case["recovery"]:
            assert case["days_to_recovery"] == (_ts(case["recovery"]) - peak).days
        else:
            assert case["days_to_recovery"] is None
        assert len(case["description"]) <= 120 and len(case["short_name"]) <= 16


def test_every_case_date_is_an_observation_of_its_series(store):
    raw = pd.read_parquet(store.artifact_path)
    raw.index = pd.to_datetime(raw.index, utc=True)
    for case in store.cases()["cases"]:
        series = pd.to_numeric(raw[COLUMN[case["series"]["key"]]], errors="coerce").dropna()
        native = series[series.ne(series.shift())]
        dates = [case["peak"], case["trough"], case["recovery"]]
        for day in filter(None, dates):
            when = _ts(day)
            assert when in native.index, (case["id"], day)
            if case["series"]["precision"] == "day" and case["kind"] != "bitcoin":
                assert when.dayofweek < 5, (case["id"], day)
        peak, trough = _ts(case["peak"]), _ts(case["trough"])
        between = native.loc[peak:trough]
        assert between.max() <= native[peak] and between.min() >= native[trough]
        if case["recovery"]:
            after = native.loc[trough:]
            assert after[after >= native[peak]].index[0] == _ts(case["recovery"])


def test_case_path_contract(store):
    catalogue = store.cases()
    for case in catalogue["cases"]:
        path = store.case_path(case["id"])
        CasePathResponse.model_validate(path)
        d, v = path["d"], path["v"]
        assert d[0] == 0 and v[0] == 0.0
        assert all(a < b for a, b in zip(d, d[1:]))
        assert len(d) == len(v)
        if path["ci"] is not None:
            assert len(path["ci"]) == len(d)
        if path["ms"] is not None:
            assert len(path["ms"]) == len(d)
        to_low = [value for day, value in zip(d, v) if day <= case["days_to_trough"]]
        # depth_pct has 1 decimal (+-0.05) and v has 2 (+-0.005)
        assert min(to_low) == pytest.approx(case["depth_pct"], abs=0.0551)
        assert len(json.dumps(path, separators=(",", ":"))) < 60_000
        assert path["t0"] == case["peak"] and path["align"] is None

    earlier = store.case_path("us-equity-2007-06", "own", -365)
    assert earlier["d"][0] < 0 and earlier["v"][earlier["d"].index(0)] == 0.0

    gold = store.case_path("us-equity-2007-06", "gold")
    assert gold["resolution"] == "monthly" and gold["base_date"] == "2007-06-01"
    assert (gold["d"][0], gold["v"][0]) == (0, 0.0) and gold["d"][1] > 0

    monthly = store.case_path("us-equity-1998-06")
    assert monthly["resolution"] == "monthly" and monthly["series_label"] == "Cowles index → S&P 500"
    splice_day = (_ts("2001-01-02") - _ts("1998-06-01")).days
    assert monthly["splices"] == [{"d": splice_day, "from": "M1125AUSM343NNBR", "to": "YAHOO_FINANCE_GSPC"}]
    at = next(i for i, day in enumerate(monthly["d"]) if day >= splice_day)
    assert abs(monthly["v"][at] - monthly["v"][at - 1]) < 1.0  # raw levels jump from 141 to 1000
    assert all(not (case["peak"] < "2001-01-01" < case["trough"]) for case in catalogue["cases"])


def test_path_keeps_marks_beyond_two_years():
    """Past 730 days the path keeps one point per 7-day bucket, but the case's
    low, lower low and recovery stay points of it wherever they fall, on the
    case's own series and (as of that day) on another series."""
    days = pd.bdate_range("2000-01-03", periods=1040, tz="UTC")  # the peak is a Monday
    knots = [(0, 100.0), (562, 60.0), (700, 91.0), (852, 50.0), (1000, 101.0), (1039, 105.0)]
    nifty = np.interp(np.arange(len(days)), [k for k, _ in knots], [v for _, v in knots])
    bonds = np.linspace(100.0, 130.0, len(days))
    frame = _small_frame({
        "nifty_proxy": [(day.date().isoformat(), float(v)) for day, v in zip(days, nifty)],
        "bond_proxy": [(day.date().isoformat(), float(v)) for day, v in zip(days, bonds)],
    })
    context = cases.build_context(frame, {}, [], [])
    case = _by_id(context.catalogue)["nifty-2000-01"]
    assert (case["trough"], case["depth_pct"]) == (days[562].date().isoformat(), -40.0)
    assert case["lower_low"] == {"date": days[852].date().isoformat(), "pct_from_peak": -50.0}
    assert case["recovery"] == days[998].date().isoformat()  # first close at or above 100
    marks = [case["days_to_trough"], (_ts(case["lower_low"]["date"]) - _ts(case["peak"])).days, case["days_to_recovery"]]
    # Each mark is a Monday-to-Thursday past 730 days, so the bucket rule alone would drop it.
    assert all(day > 730 and day % 7 < 4 for day in marks)
    for series in ("own", "bonds"):
        path = cases.build_case_path(context, case["id"], series)
        assert all(day in path["d"] for day in marks), series
        assert all(a < b for a, b in zip(path["d"], path["d"][1:]))
    own = cases.build_case_path(context, case["id"])
    to_low = [value for day, value in zip(own["d"], own["v"]) if 0 <= day <= case["days_to_trough"]]
    assert min(to_low) == case["depth_pct"]
    assert own["v"][own["d"].index(marks[1])] == -50.0


def test_today_paths(store):
    raw = pd.read_parquet(store.artifact_path)
    raw.index = pd.to_datetime(raw.index, utc=True)
    peak = store.case_path("today", "own", 0, "peak")
    assert peak["series"] == "sp500" and peak["t0"] == peak["peak_date"] == "2012-03-15"
    assert peak["current_pct_from_peak"] == -18.8 and peak["align"] == "peak"
    latest = store.case_path("today", "sp500", -365, "latest")
    assert latest["t0"] == "2013-12-31" and latest["d"][-1] == 0 and latest["d"][0] < 0
    for key in ("nifty", "bitcoin", "gold", "bonds"):
        series = pd.to_numeric(raw[COLUMN[key]], errors="coerce").dropna()
        native = series[series.ne(series.shift())]  # monthly gold is forward-filled to month ends
        top = native[native == native.max()].index[-1]
        path = store.case_path("today", key, -365, "peak")
        assert path["t0"] == top.date().isoformat()
        assert path["current_pct_from_peak"] <= 0
        assert store.case_path("today", key, 0, "latest")["t0"] == native.index[-1].date().isoformat()


def test_unknown_id_and_unavailable_series(store):
    with pytest.raises(KeyError):
        store.case_path("us-equity-1800-01")
    with pytest.raises(ValueError, match="No Bitcoin observation within 31 days of 1998-06-01"):
        store.case_path("us-equity-1998-06", "bitcoin")
    with pytest.raises(ValueError):
        store.case_path("us-equity-1998-06", "nifty")
    with pytest.raises(ValueError):
        store.case_path("us-equity-2007-06", "own", 0, "latest")
    with pytest.raises(ValueError):
        store.case_path("us-equity-2007-06", "own", -10)


def test_cache_follows_the_parquet(tmp_path):
    frame = _frame()
    artifact, meta, events = _write(tmp_path, frame)
    store = cases.CaseStore(artifact, meta, events)
    first = store.cases()
    path = store.case_path_json("us-equity-2007-06")
    assert store.case_path_json("us-equity-2007-06") is path
    deeper = frame.copy()
    deeper.loc[_ts("2008-11-20"), "sp500_proxy"] = 700.0
    deeper.to_parquet(artifact, engine="pyarrow", compression="snappy")
    stamp = artifact.stat().st_mtime + 5
    os.utime(artifact, (stamp, stamp))
    second = store.cases()
    assert second is not first
    assert _by_id(second)["us-equity-2007-06"]["depth_pct"] == round((700.0 / 1500.0 - 1) * 100, 1)
    assert len(store._paths) == 0 and store._paths_bytes == 0
    assert store.case_path_json("us-equity-2007-06") != path


def test_path_cache_is_a_bounded_lru(tmp_path):
    files = _write(tmp_path, _frame())
    store = cases.CaseStore(*files, path_cache_size=2)
    first = store.case_path_json("us-equity-1998-06")
    store.case_path_json("us-equity-2007-06")
    store.case_path_json("us-equity-1998-06")  # a hit refreshes its place
    store.case_path_json("nifty-2008-01")  # evicts us-equity-2007-06
    assert list(store._paths) == [("us-equity-1998-06", "own", 0, "peak"), ("nifty-2008-01", "own", 0, "peak")]
    assert store.case_path_json("us-equity-1998-06") is first
    assert store._paths_bytes == sum(len(body) for body in store._paths.values())
    assert store.case_path("us-equity-1998-06") == json.loads(first)
    # The byte budget bounds it too; the newest entry is always kept.
    small = cases.CaseStore(*files, path_cache_bytes=len(first))
    small.case_path_json("us-equity-1998-06")
    last = small.case_path_json("us-equity-2007-06")
    assert list(small._paths) == [("us-equity-2007-06", "own", 0, "peak")] and small._paths_bytes == len(last)


def test_coverage_dates_follow_the_data(store):
    coverage = store.cases()["coverage"]
    assert coverage["core_index_start"] == "2003-01-01"
    assert coverage["macro_strength_start"] == "1999-01-01"
    assert coverage["macro_strength_full_from"] == "2001-01-01"
    assert coverage["equity_gap"] is None
    assert coverage["series_first_obs"] == {
        "sp500": "1998-01-01", "gold": "1998-01-01", "bonds": "1998-01-02", "nifty": "2007-09-17",
        "bitcoin": "2010-08-18",
    }
    assert coverage["series_last_obs"] == {
        "sp500": "2013-12-31", "gold": "2013-12-01", "bonds": "2013-12-31", "nifty": "2013-12-31",
        "bitcoin": "2013-12-31",
    }
    assert [(item["source"], item["start"], item["end"]) for item in coverage["us_equity_segments"]] == [
        ("M1125AUSM343NNBR", "1998-01-01", "2000-12-01"),
        ("YAHOO_FINANCE_GSPC", "2001-01-02", "2013-12-31"),
    ]


def test_module_has_no_hard_coded_dates():
    """Case and coverage dates come from the data; the only ISO dates in
    cases.py are the named method boundaries in METHOD_DATES."""
    source = Path(cases.__file__).read_text(encoding="utf-8")
    found = set(re.findall(r"\b\d{4}-\d{2}-\d{2}\b", source))
    assert found == set(cases.METHOD_DATES.values())


def _write_service_artifact(tmp_path: Path) -> tuple[Path, Path]:
    index = pd.date_range("2019-01-01", "2020-12-31", freq="D", tz="UTC")
    frame = pd.DataFrame(index=index)
    frame["sp500_proxy"] = 3000.0
    frame["sp500_proxy_source"] = "TEST"
    frame["btc_proxy"] = np.linspace(7000.0, 29000.0, len(index))
    frame["btc_proxy_source"] = "TEST_BTC"
    frame["core_index"] = 12.34
    frame["core_index_bucket"] = "calm_bullish"
    frame["nber_recession"] = 0
    artifact = tmp_path / "service.parquet"
    frame.to_parquet(artifact, engine="pyarrow", compression="snappy")
    meta = tmp_path / "service.meta.json"
    meta.write_text(json.dumps({"data_version": "test-version"}), encoding="utf-8")
    return artifact, meta


def test_crypto_milestones_with_time_ordered_window_stats(tmp_path, monkeypatch):
    """The service wiring the orchestrator will apply: crypto_milestones()
    with cases.window_stats in place of the order-blind _event_window_stats."""
    import regime.service as service_module

    monkeypatch.setattr(service_module, "_event_window_stats", cases.window_stats, raising=False)
    artifact, meta = _write_service_artifact(tmp_path)
    service = service_module.MacroRegimeService(
        artifact_path=artifact, meta_path=meta, crypto_milestones_path=tmp_path / "missing.json"
    )
    payload = service.crypto_milestones()
    covid = next(event for event in payload["events"] if event["id"] == "covid-shock")
    bitcoin = covid["assets"]["bitcoin"]
    assert bitcoin["available"] is True and bitcoin["start_value"] > 0 and bitcoin["end_value"] > 0
    assert bitcoin["drawdown_pct"] == 0.0  # a rising series has no peak-to-trough fall
    assert covid["assets"]["sp500"]["available"] is True
    assert covid["core_index"]["at_peak"] == 12.34 and covid["core_index"]["at_peak_bucket"] == "calm_bullish"
    for event in payload["events"]:
        for stats in event["assets"].values():
            if stats["available"]:
                assert stats["peak_date"] <= stats["trough_date"]


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


def _client(case_store: cases.CaseStore) -> TestClient:
    app = FastAPI()
    app.include_router(cases_router.router, prefix="/api/v1")
    app.dependency_overrides[cases_router.get_case_store] = lambda: case_store
    return TestClient(app)


def test_routes_status_codes(store, tmp_path):
    client = _client(store)
    listing = client.get("/api/v1/regime/cases")
    assert listing.status_code == 200 and listing.json()["counts"]["total"] == 6
    ok = client.get("/api/v1/regime/cases/us-equity-1998-06/path")
    assert ok.status_code == 200 and ok.headers["content-type"] == "application/json"
    CasePathResponse.model_validate(ok.json())  # the route sends the cached JSON as is
    assert ok.json() == store.case_path("us-equity-1998-06")
    assert ok.json()["splices"][0]["from"] == "M1125AUSM343NNBR"
    today = client.get("/api/v1/regime/cases/today/path", params={"series": "nifty", "align": "latest", "from": -365})
    assert today.status_code == 200 and today.json()["align"] == "latest"
    assert client.get("/api/v1/regime/cases/us-equity-1800-01/path").status_code == 404
    assert client.get("/api/v1/regime/cases/us-equity-1998-06/path", params={"series": "dax"}).status_code == 422
    assert client.get("/api/v1/regime/cases/us-equity-1998-06/path", params={"series": "bitcoin"}).status_code == 422
    assert client.get("/api/v1/regime/cases/us-equity-1998-06/path", params={"from": -10}).status_code == 422
    assert client.get("/api/v1/regime/cases/us-equity-1998-06/path", params={"align": "latest"}).status_code == 422
    assert client.get("/api/v1/regime/cases/BAD_ID/path").status_code == 422
    missing = _client(cases.CaseStore(tmp_path / "missing.parquet", tmp_path / "missing.json", tmp_path / "none.json"))
    assert missing.get("/api/v1/regime/cases").status_code == 503
    assert missing.get("/api/v1/regime/cases/today/path").status_code == 503


# ---------------------------------------------------------------------------
# Golden checks on the committed parquet (dates and depths only: Core Index
# values are left out because Core Index V2 changes them)
# ---------------------------------------------------------------------------

GOLDEN = {
    "us-equity-2007-10": ("Global Financial Crisis", "2007-10-09", "2009-03-09", -56.8),
    "us-equity-2020-02": ("COVID-19 crash", "2020-02-19", "2020-03-23", -33.9),
    "us-equity-2000-03": ("Dot-com bust", "2000-03-24", "2002-10-09", -49.1),
    "us-equity-1987-08": ("1987 stock market crash", "1987-08-25", "1987-12-04", -33.5),
    "us-equity-1973-01": ("1973–74 stock market crash", "1973-01-11", "1974-10-03", -48.2),
    "us-equity-2022-01": ("2022 bear market", "2022-01-03", "2022-10-12", -25.4),
    "us-equity-2025-02": ("S&P 500 decline of 2025", "2025-02-19", "2025-04-08", -18.9),
    "us-equity-1929-09": ("Wall Street Crash of 1929", "1929-09-16", "1932-06-01", -86.2),
    # Peaks on 9 Nov 1938; a returning 1938-10-10 vendor misprint would move it.
    "us-equity-1938-11": ("S&P 90 decline of 1938–42", "1938-11-09", "1942-04-28", -45.8),
    "us-equity-1906-09": ("Panic of 1907", "1906-09-01", "1907-11-01", -37.6),
    "nifty-2008-01": ("Global Financial Crisis (Nifty 50)", "2008-01-08", "2008-10-27", -59.9),
    "btc-2017-12": ("Crypto Winter", "2017-12-17", "2018-12-16", -83.2),
}


@pytest.fixture(scope="module")
def committed() -> cases.CaseStore:
    if not cases.DEFAULT_ARTIFACT.exists():
        pytest.skip("committed macro artifact is absent")
    return cases.CaseStore()


def test_golden_cases(committed):
    by_id = _by_id(committed.cases())
    for case_id, (name, peak, trough, depth) in GOLDEN.items():
        case = by_id[case_id]
        assert (case["name"], case["peak"], case["trough"], case["depth_pct"]) == (name, peak, trough, depth), case_id


def test_golden_catalogue_holds(committed):
    catalogue = committed.cases()
    CasesResponse.model_validate(catalogue)
    assert cases.validate_catalogue(committed.context()) == []
    assert committed.context().warnings == []
    ids = {case["id"] for case in catalogue["cases"]}
    assert catalogue["default_pair"] == {"a": "us-equity-2007-10", "b": "us-equity-2020-02"}
    assert len(catalogue["pairs"]) == len(cases.PAIRS)
    assert all(pair["a"] in ids and pair["b"] in ids for pair in catalogue["pairs"])
    minimum = {"us_equity": 33, "india_equity": 7, "bitcoin": 9, "gold": 5, "treasury": 3}
    assert all(catalogue["counts"][kind] >= count for kind, count in minimum.items())
    assert "us_recession" not in {case["kind"] for case in catalogue["cases"]}
    assert catalogue["coverage"]["equity_gap"] is None
    assert len(json.dumps(catalogue, separators=(",", ":"), ensure_ascii=False).encode()) < 150_000


def test_golden_case_dates_are_observations(committed):
    """Independent of regime.cases: every peak, low and recovery is a native
    observation, nothing lies above the peak or below the low between them,
    and the recovery is the first regain. Daily series other than Bitcoin use
    weekdays only (the Treasury model accrues carry on weekends)."""
    raw = pd.read_parquet(cases.DEFAULT_ARTIFACT, columns=[*COLUMN.values()])
    raw.index = pd.to_datetime(raw.index, utc=True)
    for case in committed.cases()["cases"]:
        series = pd.to_numeric(raw[COLUMN[case["series"]["key"]]], errors="coerce").dropna()
        native = series[series.ne(series.shift())]
        if case["series"]["precision"] == "day" and case["kind"] != "bitcoin":
            native = native[native.index.dayofweek < 5]
        for day in filter(None, (case["peak"], case["trough"], case["recovery"])):
            assert _ts(day) in native.index, (case["id"], day)
        peak, trough = _ts(case["peak"]), _ts(case["trough"])
        between = native.loc[peak:trough]
        assert between.max() <= native[peak] and between.min() >= native[trough], case["id"]
        if case["recovery"]:
            after = native.loc[trough:]
            assert after[after >= native[peak]].index[0] == _ts(case["recovery"]), case["id"]


def test_golden_paths(committed):
    gfc = committed.case_path("us-equity-2007-10")
    assert len(gfc["d"]) < 1500 and len(json.dumps(gfc, separators=(",", ":"))) < 60_000
    assert gfc["splices"] == [] and gfc["ends"] == "data_end"
    panic = committed.case_path("us-equity-1906-09")
    assert panic["resolution"] == "monthly" and panic["ends"] == "until"
    assert [(s["from"], s["to"]) for s in panic["splices"]] == [("M1125AUSM343NNBR", "YAHOO_FINANCE_GSPC")]
    at = next(i for i, day in enumerate(panic["d"]) if day >= panic["splices"][0]["d"])
    assert abs(panic["v"][at] - panic["v"][at - 1]) < 10.0
    for key in cases.SERIES_KEYS:
        peak = committed.case_path("today", key, -365, "peak")
        assert peak["current_pct_from_peak"] <= 0 and 0 in peak["d"]
        latest = committed.case_path("today", key, -365, "latest")
        assert latest["d"][-1] == 0 and latest["t0"] == latest["last_obs"]


def test_golden_paths_keep_case_marks(committed):
    """Every committed case, on its own series (every allowed from) and each
    other available one: the low, the recovery and the lower low are points of
    the path (on another series, the last observation on or before each), and
    the own path's lowest value up to the low is depth_pct. today (align=peak)
    keeps its lowest observation since the peak."""
    context = committed.context()
    for case in committed.cases()["cases"]:
        own_key = case["series"]["key"]
        peak = _ts(case["peak"])
        marks = [case["trough"], case["recovery"], case["lower_low"]["date"] if case["lower_low"] else None]
        combos = [("own", frm) for frm in cases.ALLOWED_FROM_DAYS]
        combos += [(key, 0) for key in case["series_available"] if key != own_key]
        for series, frm in combos:
            path = cases.build_case_path(context, case["id"], series, frm)
            d = set(path["d"])
            data = context.series[own_key if series == "own" else series]
            for mark in filter(None, marks):
                # A monthly value from before the peak is the base, drawn at (0, 0.0).
                day = max((data.index[data.position(_ts(mark))] - peak).days, 0)
                assert day in d or day > path["d"][-1], (case["id"], series, frm, mark)
            if series == "own":
                assert case["days_to_trough"] in d, (case["id"], frm)
                to_low = [v for day, v in zip(path["d"], path["v"]) if 0 <= day <= case["days_to_trough"]]
                assert min(to_low) == pytest.approx(case["depth_pct"], abs=0.0551), (case["id"], frm)
    for key in cases.SERIES_KEYS:
        path = cases.build_case_path(context, "today", key, 0, "peak")
        since = context.series[key].eras[-1].obs.loc[_ts(path["t0"]):]
        assert (since.idxmin() - _ts(path["t0"])).days in path["d"], key
        assert min(path["v"]) == round((since.min() / since.iloc[0] - 1.0) * 100.0, 2), key
