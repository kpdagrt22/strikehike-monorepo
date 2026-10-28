from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from regime.patterns import (  # noqa: E402
    PATTERN_WINDOW_DAYS,
    build_patterns_payload,
)
from regime.schemas import PatternsResponse  # noqa: E402


def _pattern_frame() -> pd.DataFrame:
    index = pd.date_range("1899-01-01", "2020-12-31", freq="D", tz="UTC")
    steps = np.arange(len(index), dtype=float)
    frame = pd.DataFrame(index=index)

    # A smooth long-run equity path with a visible boom and drawdown so the
    # forward peak/drawdown fields are exercised, not just the happy path.
    frame["sp500_proxy"] = 100.0 * np.exp(steps / 9000.0) * (
        1.0 + 0.08 * np.sin(steps / 240.0)
    )
    frame["sp500_proxy_source"] = "TEST_EQUITY"
    frame["nber_phase"] = "expansion"
    frame["core_index"] = 12.0
    frame["core_index_bucket"] = "calm_bullish"

    nifty = pd.Series(np.nan, index=index)
    nifty.loc["2008-01-01":] = 5000.0 * np.exp(
        np.arange(len(nifty.loc["2008-01-01":]), dtype=float) / 4500.0
    )
    frame["nifty_proxy"] = nifty
    frame["nifty_proxy_source"] = pd.Series(
        "TEST_NIFTY", index=index
    ).where(nifty.notna())
    return frame


def test_sp500_uses_exact_120_year_date_and_one_year_forward():
    payload = build_patterns_payload(
        _pattern_frame(),
        today="2020-06-30",
        asset="sp500",
    )

    assert payload["as_of"] == "2020-06-30"
    assert payload["historical_date"] == "1900-06-30"
    assert payload["requested_historical_date"] == "1900-06-30"
    assert payload["mirror_fallback"] is False
    assert payload["mirror_note"] is None
    assert payload["forward"]["start"] == "1900-06-30"
    assert payload["forward"]["end"] == "1901-06-30"
    assert payload["forward"]["asset"] == "S&P 500 / long-run equity proxy"
    assert len(payload["current"]["series"]) == PATTERN_WINDOW_DAYS
    assert len(payload["historical"]["series"]) == PATTERN_WINDOW_DAYS
    assert 0.0 <= payload["similarity_percentage"] <= 100.0
    assert payload["correlation"] >= 0.0
    assert payload["forward"]["peak"]["value"] > 0
    assert payload["forward"]["drawdown_peak"]["value"] > 0
    assert payload["forward"]["max_drawdown_pct"] <= 0
    validated = PatternsResponse(**payload)
    assert validated.forward.drawdown_peak.value > 0


def test_short_history_asset_uses_earliest_complete_mirror():
    payload = build_patterns_payload(
        _pattern_frame(),
        today="2020-06-30",
        asset="nifty",
    )

    expected_mirror = (
        pd.Timestamp("2008-01-01") + pd.Timedelta(days=PATTERN_WINDOW_DAYS)
    )
    assert payload["historical_date"] == expected_mirror.date().isoformat()
    assert payload["requested_historical_date"] == "1900-06-30"
    assert payload["mirror_fallback"] is True
    assert "history begins" in payload["mirror_note"]
    assert payload["forward"]["start"] == payload["historical_date"]
    assert payload["forward"]["end"] == "2009-12-31"
    assert payload["current"]["asset"] == "Nifty 50 — India"
    assert any(event["date"] == "2009-01-07" for event in payload["events"])
    assert PatternsResponse(**payload).mirror_fallback is True


def test_unknown_pattern_asset_raises_value_error():
    with pytest.raises(ValueError, match="Unknown pattern asset"):
        build_patterns_payload(
            _pattern_frame(),
            today="2020-06-30",
            asset="not-an-asset",
        )


# ---------------------------------------------------------------------------
# Study of Patterns v2: regime/patterns_v2.py and scripts/patterns_v2_evidence.py
#
# Synthetic frames only, except test_committed_skill_artifact_matches_the_parquet,
# which checks the committed skill artifact against the committed metadata.
# ---------------------------------------------------------------------------

import json  # noqa: E402
import math  # noqa: E402
import os  # noqa: E402
import re  # noqa: E402
import time  # noqa: E402

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from regime import patterns_v2 as P2  # noqa: E402
from regime.schemas import (  # noqa: E402
    PatternEngineV2,
    PatternMirrorEvidenceV2,
    PatternSkillV2,
)
from scripts import patterns_v2_evidence as EV  # noqa: E402

UTC = "UTC"
PROCESSED_DIR = Path(__file__).resolve().parents[1] / "data" / "processed"
SKILL_COMMAND = (
    'cd backend && PYTHONPATH="src;." python -m scripts.patterns_v2_evidence '
    "--parquet data/processed/macro_regime_history.parquet "
    "--meta data/processed/macro_regime_history.meta.json "
    "--out data/processed/patterns_v2_skill.json"
)


def _walk(index: pd.DatetimeIndex, seed: int, vol: float = 0.17) -> pd.Series:
    rng = np.random.default_rng(seed)
    trading = index.dayofweek < 5
    r = np.where(trading, 0.05 / 252 + vol / math.sqrt(252) * rng.standard_normal(len(index)), 0.0)
    return pd.Series(np.exp(np.cumsum(r)), index=index)


def _monthly_native(price: pd.Series, mask: np.ndarray) -> pd.Series:
    """Monthly average of trading-day prices, written on every day of the month."""
    month = price.index.tz_localize(None).to_period("M")
    tr = price.where(price.index.dayofweek < 5)
    mavg = tr.groupby(month).mean()
    return pd.Series(np.where(mask, mavg.reindex(month).to_numpy(), np.nan), index=price.index)


def engine_frame(seed: int = 7, end: str = "2026-10-23", ffill_to: str = "2026-10-27") -> pd.DataFrame:
    """An S&P-shaped splice (Cowles/DJIA monthly, a 1969-71 gap, Nasdaq then S&P
    daily, each on its own level scale), a Nifty-like daily series from 2007 and
    a gold-like monthly series (peg until 1968, October not yet published)."""
    idx = pd.date_range("1870-12-01", ffill_to, freq="D", tz=UTC)
    last = pd.Timestamp(end, tz=UTC)
    base = _walk(idx, seed) * 37.0
    sp = pd.Series(np.nan, index=idx)
    src = pd.Series(pd.NA, index=idx, dtype="string")
    eras = [("1871-01-01", "1956-12-01", "M1125AUSM343NNBR", True, 1.0), ("1956-12-02", "1968-12-01", "M1109BUSM293NNBR", True, 1.4),
            ("1971-02-05", "2016-10-26", "NASDAQCOM", False, 0.2), ("2016-10-27", ffill_to, "SP500", False, 0.08)]
    for a, b, name, monthly, scale in eras:  # different level scales: the splice must be chained
        m = (idx >= pd.Timestamp(a, tz=UTC)) & (idx <= pd.Timestamp(b, tz=UTC))
        vals = _monthly_native(base, m) if monthly else base.where(m & (idx.dayofweek < 5) & (idx <= last)).ffill().where(m)
        sp[m] = (vals * scale)[m]
        src[m] = name
    frame = pd.DataFrame({"sp500_proxy": sp, "sp500_proxy_source": src})
    nf = _walk(idx, seed + 1, 0.2) * 5000.0
    nmask = (idx >= pd.Timestamp("2007-09-17", tz=UTC))
    frame["nifty_proxy"] = nf.where(nmask & (idx.dayofweek < 5) & (idx <= last)).ffill().where(nmask)
    frame["nifty_proxy_source"] = pd.Series("YAHOO_FINANCE_NSEI", index=idx, dtype="string").where(nmask)
    g = _walk(idx, seed + 2, 0.15) * 35.0
    gmask = idx >= pd.Timestamp("1960-01-01", tz=UTC)
    gold = _monthly_native(g, gmask)
    gold[idx < pd.Timestamp("1968-04-01", tz=UTC)] = 35.0  # the peg: flat windows are dropped
    gold[gmask & (idx >= pd.Timestamp("2026-10-01", tz=UTC))] = np.nan  # October not published yet
    frame["gold_proxy"] = gold.where(gmask).ffill().where(gmask)  # parquet-style trailing fill
    frame["gold_proxy_source"] = pd.Series("WORLD_BANK_LBMA_GOLD", index=idx, dtype="string").where(gmask)
    return frame


def gspc_frame(seed: int = 11, end: str = "2026-10-27", ffill_to: str = "2026-10-28") -> pd.DataFrame:
    """Today's S&P lens: Cowles monthly values to 1927-12-29, then daily
    YAHOO_FINANCE_GSPC closes on another level scale (the S&P 90 until 1957-03-04)."""
    idx = pd.date_range("1870-12-01", ffill_to, freq="D", tz=UTC)
    last = pd.Timestamp(end, tz=UTC)
    base = _walk(idx, seed) * 37.0
    cowles = (idx >= pd.Timestamp("1871-01-01", tz=UTC)) & (idx <= pd.Timestamp("1927-12-29", tz=UTC))
    daily = idx >= pd.Timestamp("1927-12-30", tz=UTC)
    sp = pd.Series(np.nan, index=idx)
    sp[cowles] = _monthly_native(base, cowles)[cowles]
    sp[daily] = (base.where(daily & (idx.dayofweek < 5) & (idx <= last)).ffill() * 0.5)[daily]
    src = pd.Series(pd.NA, index=idx, dtype="string")
    src[cowles] = "M1125AUSM343NNBR"
    src[daily] = "YAHOO_FINANCE_GSPC"
    return pd.DataFrame({"sp500_proxy": sp, "sp500_proxy_source": src})


@pytest.fixture(scope="module")
def v2_frame() -> pd.DataFrame:
    return engine_frame()


@pytest.fixture(scope="module")
def gspc_df() -> pd.DataFrame:
    return gspc_frame()


@pytest.fixture(scope="module")
def sp_payload(v2_frame) -> dict:
    return P2.build_engine_payload(v2_frame, "sp500")


@pytest.fixture(scope="module")
def gspc_payload(gspc_df) -> dict:
    return P2.build_engine_payload(gspc_df, "sp500")


def _months_between(a: str, b: str) -> int:
    pa, pb = pd.Timestamp(a), pd.Timestamp(b)
    return (pb.year - pa.year) * 12 + (pb.month - pa.month)


def _assert_truncation_invariant(frame: pd.DataFrame, asset: str, months: list[str]) -> None:
    """The forecast at a past date equals the one built on data cut at that date."""
    cfg = P2.PRIMARY[asset]
    full = P2.bank_for(frame, asset, cfg)
    for month in months:
        i = next(k for k in range(full.n) if full.valid_win[k] and full.dates[k].strftime("%Y-%m") == month)
        fc = P2.analog_forecast(full, i)
        assert fc is not None, (asset, month)
        payload = P2.build_engine_payload(frame.loc[: full.dates[i]], asset)
        assert payload["as_of"] == full.dates[i].date().isoformat()
        # Same eligible library: nothing whose outcome ends after the cut was usable.
        assert payload["outlook"]["library_windows"] == len(fc["cand"])
        assert all(int(c) + cfg.horizon <= i - cfg.window for c in fc["cand"])
        assert [a["window"]["end"] for a in payload["analogs"]] == [full.dates[c].date().isoformat() for c in fc["chosen"]]
        assert [h["higher"] for h in payload["outlook"]["horizons"]] == [fc[f"higher_{h}"] for h in cfg.horizons]
        assert payload["outlook"]["drawdown"]["base_share_20_pct"] == round(fc["base"]["p_dd20"] * 100, 1)


def test_no_lookahead_truncation_invariance(v2_frame):
    _assert_truncation_invariant(v2_frame, "sp500", ["1935-06", "1987-09", "2008-08", "2020-01"])


def test_no_lookahead_on_daily_sp500_nifty_and_gold(v2_frame, gspc_df):
    _assert_truncation_invariant(gspc_df, "sp500", ["1932-06", "1974-09", "2009-02"])
    _assert_truncation_invariant(v2_frame, "nifty", ["2016-02", "2020-03"])
    _assert_truncation_invariant(v2_frame, "gold", ["1999-09", "2013-04"])


def test_truncation_check_catches_injected_lookahead(v2_frame, monkeypatch):
    """The no-look-ahead check has teeth: it fails when a leak is injected."""
    real_distances = P2.distances

    def full_sample_scale(bank, i, cand, scale_idx=None):
        return real_distances(bank, i, cand, scale_idx=np.flatnonzero(bank.valid_win))

    def future_outcomes(bank, i):
        j = np.arange(bank.n)
        return np.flatnonzero(bank.valid_win & bank.valid_fwd & (j + bank.cfg.horizon <= i + 3))

    for name, leak in (("distances", full_sample_scale), ("eligible", future_outcomes)):
        with monkeypatch.context() as patch:
            patch.setattr(P2, name, leak)
            with pytest.raises(AssertionError):
                _assert_truncation_invariant(v2_frame, "sp500", ["1935-06", "1987-09", "2008-08", "2020-01"])


def test_every_outcome_shown_ends_by_as_of(sp_payload, gspc_payload):
    for payload in (sp_payload, gspc_payload):
        as_of, today_start = payload["as_of"], payload["current"]["start"]
        for a in payload["analogs"]:
            assert a["window"]["end"] <= as_of and a["forward"]["end"] <= as_of
            assert a["forward"]["end"] <= today_start  # never today's own trailing year
            assert a["forward"]["start"] == a["window"]["end"]
        for key in ("exact", "aligned"):
            block = payload["mirror"][key]
            assert block is not None and block["forward"]["end"] <= as_of


def test_setups_are_at_least_six_months_apart_and_ranked(sp_payload):
    ends = sorted(a["window"]["end"] for a in sp_payload["analogs"])
    assert len(ends) == 10
    assert all(_months_between(x, y) >= 6 for x, y in zip(ends, ends[1:]))
    positions = [a["position"] for a in sp_payload["analogs"]]
    assert positions == sorted(positions) and positions[0] == 1
    assert all(a["closer_than_pct"] < 100.0 for a in sp_payload["analogs"])


def test_mirror_is_exactly_120_calendar_years_back_across_the_gap(sp_payload, gspc_payload):
    for payload in (sp_payload, gspc_payload):
        exact = payload["mirror"]["exact"]
        assert payload["mirror"]["available"] is True
        assert _months_between(exact["window"]["end"], payload["as_of"]) == 120 * 12
        aligned = payload["mirror"]["aligned"]
        assert 110 <= aligned["offset_years"] <= 130 and aligned["windows_in_band"] > 200


def test_monthly_source_trailing_fill_is_cut(v2_frame):
    gold = P2.build_engine_payload(v2_frame, "gold")
    assert gold["as_of"] == "2026-09-30"  # not the forward-filled October
    assert gold["current"]["end"] == "2026-09-30"


def test_pegged_flat_windows_are_never_analogs(v2_frame):
    gold = P2.build_engine_payload(v2_frame, "gold")
    assert all(a["window"]["start"] >= "1968-04-01" for a in gold["analogs"])


def test_splices_are_chained_not_jumps(v2_frame, gspc_df):
    bank = P2.bank_for(v2_frame, "sp500")
    dates = [d.strftime("%Y-%m") for d in bank.dates]
    for month in ("1956-12", "2016-10", "2016-11"):
        k = dates.index(month)
        assert abs(bank.x[k] - bank.x[k - 1]) < 0.15  # raw levels differ by 40-60%
    daily = P2.bank_for(gspc_df, "sp500")
    months = [d.strftime("%Y-%m") for d in daily.dates]
    for month in ("1927-12", "1928-01"):
        k = months.index(month)
        assert abs(daily.x[k] - daily.x[k - 1]) < 0.15  # the daily closes sit at half the Cowles level


def test_sp500_source_codes_follow_the_daily_history(gspc_df, gspc_payload):
    from regime.analytics import SP500_DAILY_SOURCE

    assert P2.SP90_SOURCE == SP500_DAILY_SOURCE and P2.SOURCE_CODES[SP500_DAILY_SOURCE] == "sp500"
    bank = P2.bank_for(gspc_df, "sp500")
    codes: dict[str | None, list[pd.Timestamp]] = {}
    for j in np.flatnonzero(bank.valid_win):
        codes.setdefault(P2._source_code(bank, int(j)), []).append(bank.dates[int(j)])
    assert set(codes) == {"cowles", "sp90", "sp500"}  # no nasdaq or dow_jones in today's lens
    assert max(codes["cowles"]) < pd.Timestamp("1927-12-30", tz=UTC)
    assert pd.Timestamp("1927-12-30", tz=UTC) <= min(codes["sp90"]) and max(codes["sp90"]) < P2.SP500_LAUNCH
    assert min(codes["sp500"]) >= P2.SP500_LAUNCH
    assert {a["source"] for a in gspc_payload["analogs"]} <= {"cowles", "sp90", "sp500"}
    PatternEngineV2(**gspc_payload)


def test_gap_is_a_break_not_a_window(v2_frame):
    bank = P2.bank_for(v2_frame, "sp500")
    for k in range(bank.n):
        if bank.valid_win[k]:
            start, end = bank.dates[k - 12], bank.dates[k]
            assert not (start < pd.Timestamp("1971-02-01", tz=UTC) and end > pd.Timestamp("1968-12-31", tz=UTC))


def test_short_history_has_no_mirror_and_no_fallback(v2_frame):
    nifty = P2.build_engine_payload(v2_frame, "nifty")
    assert nifty["mirror"]["available"] is False
    assert nifty["mirror"]["reason"] == "history_too_short"
    assert nifty["mirror"]["exact"] is None and nifty["mirror"]["aligned"] is None
    assert nifty["history_start"] >= "2007-09-17"


def test_early_as_of_with_empty_mirror_band_does_not_raise(v2_frame):
    cut = v2_frame.loc[: pd.Timestamp("1961-06-30", tz=UTC)]
    payload = P2.build_engine_payload(cut, "sp500")
    assert payload["status"] == "ok"
    assert payload["mirror"]["available"] is False and payload["mirror"]["aligned"] is None


def test_insufficient_history_status(v2_frame):
    short = v2_frame.loc[: pd.Timestamp("2010-12-31", tz=UTC)]
    payload = P2.build_engine_payload(short, "nifty")
    assert payload["status"] == "insufficient"
    assert payload["outlook"] is None
    assert len(payload["analogs"]) < 5
    PatternEngineV2(**payload)


def test_unknown_v2_asset_raises_value_error(v2_frame):
    with pytest.raises(ValueError, match="Unknown pattern asset"):
        P2.build_engine_payload(v2_frame, "not-an-asset")


def _dropped_keys(raw: object, kept: object, path: str = "engine") -> list[str]:
    if isinstance(raw, dict) and isinstance(kept, dict):
        missing = [f"{path}.{k}" for k in raw if k not in kept]
        return missing + [m for k in raw if k in kept for m in _dropped_keys(raw[k], kept[k], f"{path}.{k}")]
    if isinstance(raw, list) and isinstance(kept, list):
        return [m for n, (a, b) in enumerate(zip(raw, kept)) for m in _dropped_keys(a, b, f"{path}[{n}]")]
    return []


def test_payload_validates_keeps_every_field_and_has_no_probabilities(sp_payload, gspc_payload):
    for payload in (sp_payload, gspc_payload):
        dumped = PatternEngineV2.model_validate(payload).model_dump()
        assert _dropped_keys(payload, dumped) == []  # the response model drops nothing
        text = json.dumps(payload, allow_nan=False)
        for banned in ('"p_up', '"p_ge_', '"p_dd', '"similarity', '"novelty', '"distance'):
            assert banned not in text
    usual = sp_payload["outlook"]["usual_paths"]
    assert len(usual["q25"]) == len(usual["q50"]) == len(usual["q75"]) == 13
    assert all(lo["value"] <= mid["value"] <= hi["value"] for lo, mid, hi in zip(usual["q25"], usual["q50"], usual["q75"]))


def _skill_doc(data_version: str, **sp500: object) -> dict:
    block = {
        "available": True,
        "period": ["1892-12-31", "2025-10-31"],
        "forecasts": 1500,
        "independent_years": 125.0,
        "direction": {"horizon_months": 12, "hit_pct": 60.0, "base_hit_pct": 65.0, "edge_ci95_pp": [-9.0, 1.0], "verdict": "no_edge"},
        "mirror_evidence": {
            "months_tested": 400, "period": ["1992-01-31", "2026-10-23"], "mean_rank_pct": 51.0, "chance_rank_pct": 50.0,
            "z": 0.2, "share_in_closest_10pct": 9.0, "rank_among_offsets": [40, 91], "offsets_years": [60, 150],
            "forward_12m_rank_corr": 0.01, "direction_hit_12m_pct": 52.0, "base_hit_12m_pct": 79.0, "verdict": "no_information",
        },
    }
    block.update(sp500)
    return {"schema_version": 1, "engine_version": "patterns-v2", "generated_at": "2026-10-28T00:00:00+00:00",
            "data_version": data_version, "assets": {"sp500": block}}


def test_skill_doc_missing_or_corrupt_degrades_quietly(v2_frame, tmp_path):
    payload = P2.build_engine_payload(v2_frame, "sp500", skill_doc=None)
    assert payload["skill"] == {"available": False}
    assert payload["mirror"]["evidence"] is None
    bad = tmp_path / "skill.json"
    for text in ("{not json", "[]", json.dumps({"engine_version": "patterns-v1", "schema_version": 1}),
                 json.dumps({"engine_version": "patterns-v2", "schema_version": 2})):
        bad.write_text(text, encoding="utf-8")
        assert P2.load_skill_doc(bad) is None
    assert P2.load_skill_doc(tmp_path / "missing.json") is None


def test_skill_block_is_marked_stale_and_never_carries_nan(v2_frame):
    nan = float("nan")
    doc = _skill_doc("abc", ranking={"horizon_months": 3, "rank_corr": nan, "ci95": [nan, 0.1],
                                     "recent_from": "1959-01-01", "verdict": "none"})
    fresh = P2.build_engine_payload(v2_frame, "sp500", skill_doc=doc, data_version="abc")
    stale = P2.build_engine_payload(v2_frame, "sp500", skill_doc=doc, data_version="def")
    assert fresh["skill"]["available"] is True and fresh["skill"]["stale"] is False
    assert stale["skill"]["stale"] is True
    assert "mirror_evidence" not in fresh["skill"] and fresh["mirror"]["evidence"]["verdict"] == "no_information"
    assert fresh["skill"]["ranking"]["rank_corr"] is None and fresh["skill"]["ranking"]["ci95"] == [None, 0.1]
    json.dumps(fresh, allow_nan=False)  # FastAPI refuses NaN: one would turn the response into a 500
    PatternEngineV2(**fresh)


def test_runtime_budget(v2_frame):
    t = time.perf_counter()
    P2.build_engine_payload(v2_frame, "sp500")
    assert time.perf_counter() - t < 2.0  # measured ~0.1 s; generous for CI runners


def test_evidence_statistics_are_numpy_only_and_correct():
    a = np.array([1.0, 2.0, 3.0, 4.0, 5.0])
    assert EV.spearman(a, a) == pytest.approx(1.0)
    assert EV.spearman(a, -a) == pytest.approx(-1.0)
    assert math.isnan(EV.spearman(a[:2], a[:2]))
    assert EV.auc(np.array([0.1, 0.4, 0.35, 0.8]), np.array([0, 0, 1, 1])) == pytest.approx(0.75)
    assert EV.auc(np.array([0.2, 0.3]), np.array([1, 1])) is None
    assert EV.brier_skill(np.array([0.5]), np.array([0.5]), np.array([1.0])) == pytest.approx(0.0)
    assert EV.brier_skill(np.array([1.0, 0.0]), np.array([0.5, 0.5]), np.array([1.0, 0.0])) == pytest.approx(1.0)
    for module in (P2, EV):
        source = Path(module.__file__).read_text(encoding="utf-8")
        assert not re.search(r"^\s*(import|from)\s+scipy", source, re.MULTILINE)


def test_evidence_walk_forward_is_causal_on_synthetic_nifty(v2_frame):
    bank = P2.bank_for(v2_frame, "nifty")
    df = EV.walk_forward(bank, "nifty")  # asserts max(setup) + H <= i - L on every forecast
    assert len(df) > 50
    doc = EV.score(df, bank, "nifty")
    assert doc["direction"]["verdict"] in {"no_edge", "worse", "better"}
    PatternSkillV2(**doc)
    json.dumps(P2.json_safe(doc), allow_nan=False)


def _strict_json(path: Path) -> dict:
    def reject(constant: str) -> None:
        raise ValueError(f"non-finite number {constant} in {path.name}")

    return json.loads(path.read_text(encoding="utf-8"), parse_constant=reject)


def test_skill_artifact_is_strict_json_and_one_asset_cannot_sink_it(v2_frame, tmp_path):
    nifty_only = v2_frame[["nifty_proxy", "nifty_proxy_source"]]
    path = EV.write_skill_artifact(nifty_only, tmp_path / P2.SKILL_FILENAME, data_version="abc123")
    doc = _strict_json(path)
    assert doc["schema_version"] == 1 and doc["engine_version"] == "patterns-v2"
    assert doc["data_version"] == "abc123"
    assert doc["assets"]["sp500"]["available"] is False and "error" in doc["assets"]["sp500"]
    assert doc["assets"]["nifty"]["available"] is True
    PatternSkillV2(**doc["assets"]["nifty"])
    assert P2.load_skill_doc(path) == doc
    assert not path.with_name(path.name + ".tmp").exists()


def test_ingestion_hook_is_never_fatal(v2_frame, tmp_path, monkeypatch):
    from scripts.flows import macro_ingestion

    calls = []

    def fake_writer(frame, path, *, data_version):
        calls.append((Path(path), data_version))
        Path(path).write_text("{}", encoding="utf-8")
        return Path(path)

    monkeypatch.setattr(EV, "write_skill_artifact", fake_writer)
    written = macro_ingestion.write_patterns_skill_artifact(v2_frame, tmp_path, data_version="abc123")
    assert written == tmp_path / P2.SKILL_FILENAME and calls == [(written, "abc123")]

    def broken(*args, **kwargs):
        raise RuntimeError("simulated evidence failure")

    monkeypatch.setattr(EV, "write_skill_artifact", broken)
    assert macro_ingestion.write_patterns_skill_artifact(v2_frame, tmp_path, data_version="abc123") is None


def test_committed_skill_artifact_matches_the_parquet():
    """A refreshed parquet without a regenerated skill artifact fails CI."""
    meta_path = PROCESSED_DIR / "macro_regime_history.meta.json"
    skill_path = PROCESSED_DIR / P2.SKILL_FILENAME
    if not meta_path.exists():
        pytest.skip("no committed macro artifact in this checkout")
    assert skill_path.exists(), f"{skill_path.name} is missing; regenerate it: {SKILL_COMMAND}"
    doc = _strict_json(skill_path)
    assert P2.load_skill_doc(skill_path) == doc and doc["schema_version"] == 1
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    assert doc["data_version"] == meta["data_version"], f"{skill_path.name} is stale; regenerate it: {SKILL_COMMAND}"
    assert set(doc["assets"]) == set(P2.PRIMARY)
    for block in doc["assets"].values():
        PatternSkillV2(**{k: v for k, v in block.items() if k != "mirror_evidence"})
    sp = doc["assets"]["sp500"]
    assert sp["available"] is True
    PatternMirrorEvidenceV2(**sp["mirror_evidence"])


# Service and route (the tmp-parquet pattern of test_regime_service.py).


@pytest.fixture()
def engine_service(v2_frame, tmp_path):
    from regime.service import MacroRegimeService

    artifact = tmp_path / "macro_regime_history.parquet"
    v2_frame.to_parquet(artifact, engine="pyarrow", compression="snappy")
    meta = tmp_path / "macro_regime_history.meta.json"
    meta.write_text(json.dumps({"data_version": "test-version"}), encoding="utf-8")
    return MacroRegimeService(artifact_path=artifact, meta_path=meta)


def test_service_patterns_returns_v1_fields_plus_validated_engine(engine_service):
    payload = engine_service.patterns(asset="sp500", today="2026-10-27")
    assert {"historical_date", "similarity_percentage", "forward", "events", "notes"} <= set(payload)
    engine = payload["engine"]
    assert engine is not None and engine["version"] == "patterns-v2" and engine["asset"] == "sp500"
    assert engine["skill"] == {"available": False}  # no skill artifact next to this parquet
    validated = PatternsResponse(**payload)
    assert validated.engine is not None and validated.engine.as_of == engine["as_of"]
    assert PatternsResponse(**{**payload, "engine": None}).engine is None
    assert PatternsResponse(**{k: v for k, v in payload.items() if k != "engine"}).engine is None


def test_service_engine_is_cached_until_an_input_changes(engine_service, monkeypatch):
    calls: list[str] = []
    real = P2.build_engine_payload

    def counting(frame, asset, **kwargs):
        calls.append(asset)
        return real(frame, asset, **kwargs)

    monkeypatch.setattr(P2, "build_engine_payload", counting)
    first = engine_service.patterns(asset="sp500", today="2026-10-27")["engine"]
    second = engine_service.patterns(asset="sp500", today="2026-10-27")["engine"]
    assert calls == ["sp500"] and second is first
    engine_service.patterns(asset="nifty", today="2026-10-27")
    assert calls == ["sp500", "nifty"]

    # A new skill artifact: rebuilt, and stale because its data_version
    # differs from the metadata's.
    engine_service.patterns_skill_path.write_text(json.dumps(_skill_doc("other-version")), encoding="utf-8")
    with_skill = engine_service.patterns(asset="sp500", today="2026-10-27")["engine"]
    assert calls == ["sp500", "nifty", "sp500"]
    assert with_skill["skill"]["available"] is True and with_skill["skill"]["stale"] is True

    # A rewritten parquet (new mtime) clears the cache.
    artifact = engine_service.artifact_path
    later = artifact.stat().st_mtime + 60
    os.utime(artifact, (later, later))
    engine_service.patterns(asset="sp500", today="2026-10-27")
    assert calls == ["sp500", "nifty", "sp500", "sp500"]
    assert set(engine_service._patterns_engine_cache) == {"sp500"}


def test_service_engine_failure_degrades_to_null_and_never_raises(engine_service, monkeypatch, caplog):
    def broken(*args, **kwargs):
        raise RuntimeError("simulated engine failure")

    monkeypatch.setattr(P2, "build_engine_payload", broken)
    with caplog.at_level("ERROR", logger="regime.service"):
        payload = engine_service.patterns(asset="sp500", today="2026-10-27")
    assert payload["engine"] is None and payload["historical_date"]
    assert "Study of Patterns v2 engine unavailable for sp500" in caplog.text
    assert PatternsResponse(**payload).engine is None

    # A payload that breaks the contract also degrades to null.
    monkeypatch.setattr(P2, "build_engine_payload", lambda *args, **kwargs: {"version": "patterns-v2"})
    assert engine_service.patterns(asset="sp500", today="2026-10-27")["engine"] is None


def test_patterns_route_answers_200_with_or_without_engine(engine_service, monkeypatch):
    import regime.router as router_module

    monkeypatch.setattr(router_module, "_service", engine_service)
    app = FastAPI()
    app.include_router(router_module.patterns_router, prefix="/api/v1")
    client = TestClient(app)
    ok = client.get("/api/v1/patterns", params={"asset": "sp500"})
    assert ok.status_code == 200 and ok.json()["engine"]["version"] == "patterns-v2"
    assert client.get("/api/v1/patterns", params={"asset": "dax"}).status_code == 422

    def broken(*args, **kwargs):
        raise RuntimeError("simulated engine failure")

    monkeypatch.setattr(P2, "build_engine_payload", broken)
    failed = client.get("/api/v1/patterns", params={"asset": "nifty"})
    assert failed.status_code == 200 and failed.json()["engine"] is None
