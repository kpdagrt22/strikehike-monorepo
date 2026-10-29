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
# Study of Patterns v2 (judge r2): regime/patterns_v2.py and
# scripts/patterns_v2_evidence.py
#
# Synthetic frames only, except test_committed_skill_artifact_matches_the_parquet,
# which checks the committed skill artifact against the committed parquet.
# ---------------------------------------------------------------------------

import json  # noqa: E402
import math  # noqa: E402
import os  # noqa: E402
import re  # noqa: E402
import time  # noqa: E402

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from regime import patterns_v2 as P2  # noqa: E402
from regime.patterns_v2_schemas import (  # noqa: E402
    PatternDeclinesV2,
    PatternEngineV2,
    PatternMirrorEvidenceV2,
    PatternSkillV2,
)
from scripts import patterns_v2_evidence as EV  # noqa: E402

UTC = "UTC"
V2_ASSETS = ("sp500", "nifty", "gold", "bonds", "bitcoin")
PROCESSED_DIR = Path(__file__).resolve().parents[1] / "data" / "processed"
SKILL_COMMAND = (
    'cd backend && PYTHONPATH="src;." python -m scripts.patterns_v2_evidence '
    "--parquet data/processed/macro_regime_history.parquet "
    "--out data/processed/patterns_v2_skill.json"
)


def _walk(index: pd.DatetimeIndex, seed: int, vol: float = 0.17, every_day: bool = False) -> pd.Series:
    rng = np.random.default_rng(seed)
    trading = np.ones(len(index), dtype=bool) if every_day else index.dayofweek < 5
    r = np.where(trading, 0.05 / 252 + vol / math.sqrt(252) * rng.standard_normal(len(index)), 0.0)
    return pd.Series(np.exp(np.cumsum(r)), index=index)


def _monthly_native(price: pd.Series, mask: np.ndarray) -> pd.Series:
    """Monthly average of trading-day prices, written on every day of the month."""
    month = price.index.tz_localize(None).to_period("M")
    tr = price.where(price.index.dayofweek < 5)
    mavg = tr.groupby(month).mean()
    return pd.Series(np.where(mask, mavg.reindex(month).to_numpy(), np.nan), index=price.index)


def _closes(price: pd.Series, mask: np.ndarray, last: pd.Timestamp, every_day: bool = False) -> pd.Series:
    """Daily closes inside ``mask`` up to ``last``, forward-filled over the calendar like the parquet."""
    idx = price.index
    trading = np.ones(len(idx), dtype=bool) if every_day else idx.dayofweek < 5
    return price.where(mask & trading & (idx <= last)).ffill().where(mask)


def engine_frame(seed: int = 7, end: str = "2026-10-23", ffill_to: str = "2026-10-27") -> pd.DataFrame:
    """Today's lens on a UTC daily calendar forward-filled past the last close.

    S&P: Cowles-like monthly values 1871-01 to 1927-12-29, then daily
    YAHOO_FINANCE_GSPC closes from 1927-12-30 on another level scale (the S&P
    90 until 1957-03-04). Nifty daily from 2007-09-17, bonds daily from 1962,
    bitcoin every day from 2010-08-18, and gold monthly from 1960, pegged flat
    until March 1968, its October 2026 not yet published.
    """
    idx = pd.date_range("1870-12-01", ffill_to, freq="D", tz=UTC)
    last = pd.Timestamp(end, tz=UTC)
    base = _walk(idx, seed) * 37.0
    cowles = (idx >= pd.Timestamp("1871-01-01", tz=UTC)) & (idx <= pd.Timestamp("1927-12-29", tz=UTC))
    daily = idx >= pd.Timestamp("1927-12-30", tz=UTC)
    sp = pd.Series(np.nan, index=idx)
    sp[cowles] = _monthly_native(base, cowles)[cowles]
    sp[daily] = (_closes(base, daily, last) * 0.5)[daily]  # another level scale: the splice must be chained
    src = pd.Series(pd.NA, index=idx, dtype="string")
    src[cowles] = "M1125AUSM343NNBR"
    src[daily] = "YAHOO_FINANCE_GSPC"
    frame = pd.DataFrame({"sp500_proxy": sp, "sp500_proxy_source": src})

    def add(asset: str, values: pd.Series, mask: np.ndarray, source: str) -> None:
        spec = P2.ASSETS[asset]
        frame[spec["field"]] = values
        frame[spec["source_field"]] = pd.Series(source, index=idx, dtype="string").where(mask)

    nmask = idx >= pd.Timestamp("2007-09-17", tz=UTC)
    add("nifty", _closes(_walk(idx, seed + 1, 0.2) * 5000.0, nmask, last), nmask, "YAHOO_FINANCE_NSEI")
    bmask = idx >= pd.Timestamp("1962-01-02", tz=UTC)
    add("bonds", _closes(_walk(idx, seed + 3, 0.07) * 100.0, bmask, last), bmask, "UST10Y_TOTAL_RETURN_PROXY")
    cmask = idx >= pd.Timestamp("2010-08-18", tz=UTC)
    add("bitcoin", _closes(_walk(idx, seed + 4, 0.6, every_day=True) * 0.07, cmask, last, every_day=True), cmask, "BLOCKCHAIN_COM_MARKET_PRICE")
    gmask = idx >= pd.Timestamp("1960-01-01", tz=UTC)
    gold = _monthly_native(_walk(idx, seed + 2, 0.15) * 35.0, gmask)
    gold[idx < pd.Timestamp("1968-04-01", tz=UTC)] = 35.0  # the peg: flat windows and years are dropped
    gold[gmask & (idx >= pd.Timestamp("2026-10-01", tz=UTC))] = np.nan  # October not published yet
    add("gold", gold.where(gmask).ffill().where(gmask), gmask, "WORLD_BANK_LBMA_GOLD")  # parquet-style trailing fill
    return frame


def _bank_index(bank: P2.WindowBank, iso_date: str) -> int:
    return int(np.flatnonzero(bank.dates.strftime("%Y-%m-%d") == iso_date)[0])


def _months_between(a: str, b: str) -> int:
    pa, pb = pd.Timestamp(a), pd.Timestamp(b)
    return (pb.year - pa.year) * 12 + (pb.month - pa.month)


def _skill_doc(fingerprints: dict[str, str] | None, **sp500: object) -> dict:
    """An r2-shaped skill artifact with every block, for the sp500 asset."""
    block = {
        "available": True,
        "inputs_fingerprint": (fingerprints or {}).get("sp500"),
        "period": ["1949-12-02", "2025-10-24"],
        "cadence": "every_4_weeks",
        "forecasts": 991,
        "independent_years": 76.2,
        "direction": {"horizon_months": 12, "hit_pct": 67.7, "base_hit_pct": 74.9, "edge_ci95_pp": [-11.6, -3.0],
                      "verdict": "worse", "base_call": "up"},
        "falls_20": {"threshold_pct": 20, "realised_pct": 13.5, "brier_skill": 0.014, "ci95": [-0.069, 0.097],
                     "auc": 0.463, "verdict": "no_edge"},
        "falls_10": {"threshold_pct": 10, "realised_pct": 45.9, "brier_skill": -0.026, "ci95": [-0.06, 0.005],
                     "auc": 0.452, "verdict": "no_edge"},
        "ranking": {"horizon_months": 3, "rank_corr": -0.024, "ci95": [-0.098, 0.052], "recent_from": "1987-11-13",
                    "recent_rank_corr": 0.03, "recent_ci95": [-0.062, 0.142], "verdict": "none"},
        "placebo": {"seeds": 20, "direction_gap_pp_mean": -5.57, "direction_gap_pp_p05": -7.477,
                    "direction_gap_pp_p95": -4.036, "falls_20_brier_skill_mean": -0.067, "verdict": "same"},
        "warnings": {"threshold_pct": 20, "flagged_share_pct": 38.0, "flagged_followed_pct": 14.3, "other_followed_pct": 13.0},
        "declines": {"read_at_pct": 10, "period": ["1950-07-14", "2025-04-04"], "declines": 31, "became_20": 12,
                     "flagged": 21, "flagged_became_20": 7, "not_flagged": 10, "not_flagged_became_20": 5,
                     "auc": 0.237, "before_record": 14},
        "mirror_evidence": {
            "months_tested": 418, "period": ["1992-01-31", "2026-10-27"], "mean_rank_pct": 52.4, "chance_rank_pct": 50.0,
            "z": 0.49, "share_in_closest_10pct": 5.3, "rank_among_offsets": [59, 91], "offsets_years": [60, 150],
            "forward_12m_rank_corr": -0.064, "direction_hit_12m_pct": 50.7, "base_hit_12m_pct": 80.0,
            "verdict": "no_information",
        },
    }
    block.update(sp500)
    doc = {"schema_version": 2, "engine_version": "patterns-v2", "generated_at": "2026-10-28T00:00:00+00:00",
           "config": {}, "assets": {"sp500": block}}
    if fingerprints is not None:
        doc["inputs_fingerprint"] = fingerprints
    return doc


@pytest.fixture(scope="module")
def v2_frame() -> pd.DataFrame:
    return engine_frame()


@pytest.fixture(scope="module")
def payloads(v2_frame) -> dict[str, dict]:
    events = P2.load_events(P2.EVENTS_PATH)
    doc = _skill_doc({a: P2.inputs_fingerprint(v2_frame, a) for a in V2_ASSETS})
    return {a: P2.build_engine_payload(v2_frame, a, skill_doc=doc, events=events) for a in V2_ASSETS}


def _assert_truncation_invariant(frame: pd.DataFrame, asset: str, months: list[str], cfg: P2.Config | None = None) -> None:
    """The forecast at a past date equals the one built on data cut at that date."""
    cfg = cfg or P2.PRIMARY[asset]
    full = P2.bank_for(frame, asset, cfg)
    for month in months:
        i = next(k for k in range(full.n) if full.valid_win[k] and full.dates[k].strftime("%Y-%m") == month)
        fc = P2.analog_forecast(full, i)
        assert fc is not None, (asset, month)
        cut_frame = frame.loc[: full.dates[i]]
        cut = P2.bank_for(cut_frame, asset, cfg)
        i_cut = int(np.flatnonzero(cut.valid_win)[-1])
        assert cut.dates[i_cut] == full.dates[i], (asset, month)
        fc_cut = P2.analog_forecast(cut, i_cut)
        assert fc_cut is not None, (asset, month)
        # Same library: nothing whose outcome ends after the cut was usable.
        assert list(full.dates[fc["cand"]]) == list(cut.dates[fc_cut["cand"]]), (asset, month)
        assert all(int(c) + cfg.horizon <= i - cfg.window for c in fc["cand"])
        assert list(full.dates[fc["chosen"]]) == list(cut.dates[fc_cut["chosen"]]), (asset, month)
        np.testing.assert_allclose(fc["chosen_dist"], fc_cut["chosen_dist"], rtol=1e-9, atol=1e-12)
        for key in [f"higher_{h}" for h in cfg.horizons] + ["fell_10", "fell_20"]:
            assert fc[key] == fc_cut[key], (asset, month, key)
        for key in ["n", "p_dd10", "p_dd20"] + [f"p_up_{h}" for h in cfg.horizons]:
            assert fc["base"][key] == pytest.approx(fc_cut["base"][key], abs=1e-12), (asset, month, key)
        if cfg == P2.PRIMARY[asset]:
            payload = P2.build_engine_payload(cut_frame, asset)
            assert payload["as_of"] == full.dates[i].date().isoformat()
            assert payload["outlook"]["library_windows"] == len(fc["cand"])
            assert payload["outlook"]["usual_windows"] == fc["base"]["n"]
            assert [a["window"]["end"] for a in payload["analogs"]] == [full.dates[c].date().isoformat() for c in fc["chosen"]]
            assert [h["higher"] for h in payload["outlook"]["horizons"]] == [fc[f"higher_{h}"] for h in cfg.horizons]
            assert payload["outlook"]["drawdown"]["base_share_20_pct"] == round(fc["base"]["p_dd20"] * 100, 1)


TRUNCATION_DATES = (
    ("sp500", ["1937-03", "1974-09", "2009-02"], None),
    ("sp500", ["1935-06", "1987-09", "2020-01"], P2.MIRROR["sp500"]),
    ("nifty", ["2016-02", "2020-03"], None),
    ("gold", ["1999-09", "2013-04"], None),
)


def test_no_lookahead_truncation_invariance(v2_frame):
    for asset, months, cfg in TRUNCATION_DATES:
        _assert_truncation_invariant(v2_frame, asset, months, cfg)


def test_truncation_test_catches_injected_leaks(v2_frame, monkeypatch):
    """The no-look-ahead check has teeth: it fails when a leak is injected."""
    real_distances, real_base_rates = P2.distances, P2.base_rates

    def full_sample_scale(bank, i, cand, scale_idx=None):
        return real_distances(bank, i, cand, scale_idx=np.flatnonzero(bank.valid_win))

    def outcomes_past_t(bank, i):
        j = np.arange(bank.n)
        return np.flatnonzero(bank.valid_win & bank.valid_fwd & (j + bank.cfg.horizon <= i + 4))

    def usual_past_t(bank, i):
        return real_base_rates(bank, i + 8)

    for name, leak in (("distances", full_sample_scale), ("eligible", outcomes_past_t), ("base_rates", usual_past_t)):
        with monkeypatch.context() as patch:
            patch.setattr(P2, name, leak)
            for asset, months, cfg in TRUNCATION_DATES:
                with pytest.raises(AssertionError):
                    _assert_truncation_invariant(v2_frame, asset, months, cfg)


def test_every_setup_outcome_ends_before_todays_window(v2_frame, payloads):
    for asset, payload in payloads.items():
        bank = P2.bank_for(v2_frame, asset)
        i = _bank_index(bank, payload["current"]["end"])
        assert payload["as_of"] == payload["current"]["end"]
        for a in payload["analogs"]:
            j = _bank_index(bank, a["window"]["end"])
            assert j + bank.cfg.horizon <= i - bank.cfg.window  # the rule: j + H <= i - L
            assert a["forward"]["end"] <= payload["current"]["start"]  # never today's own trailing year
            assert a["forward"]["start"] == a["window"]["end"]
        for key in ("exact", "aligned"):
            block = payload["mirror"][key]
            if block is not None:
                assert block["forward"]["end"] <= payload["as_of"]
    assert payloads["sp500"]["mirror"]["exact"] is not None


def test_setups_do_not_overlap(v2_frame, payloads):
    for asset, payload in payloads.items():
        bank = P2.bank_for(v2_frame, asset)
        sep = payload["separation"]["periods"]
        assert sep == payload["window"]["periods"] == bank.cfg.sep and payload["separation"]["unit"] == payload["window"]["unit"]
        ends = sorted(_bank_index(bank, a["window"]["end"]) for a in payload["analogs"])
        assert 5 <= len(ends) <= 10
        assert all(b - a >= sep for a, b in zip(ends, ends[1:]))  # no two setups share a trailing year
        positions = [a["position"] for a in payload["analogs"]]
        assert positions == sorted(positions) and positions[0] == 1
        assert [a["rank"] for a in payload["analogs"]] == list(range(1, len(positions) + 1))
        assert all(a["closer_than_pct"] < 100.0 and a["of"] == payload["outlook"]["library_windows"] for a in payload["analogs"])


def test_scales_come_from_the_library_only(v2_frame, payloads):
    bank = P2.bank_for(v2_frame, "sp500")
    i = int(np.flatnonzero(bank.valid_win)[-1])
    cand = P2.eligible(bank, i)
    F, w = bank.features, bank.weights
    sd = np.nanstd(F[cand], axis=0)
    sd = np.where(sd > 1e-12, sd, 1.0)
    manual = np.sqrt(np.nansum(w * ((F[cand] - F[i]) / sd) ** 2, axis=1))
    np.testing.assert_allclose(P2.distances(bank, i, cand), manual, rtol=1e-12)
    every = np.flatnonzero(bank.valid_win)
    sd_all = np.nanstd(F[every], axis=0)
    full_sample = np.sqrt(np.nansum(w * ((F[cand] - F[i]) / np.where(sd_all > 1e-12, sd_all, 1.0)) ** 2, axis=1))
    assert not np.allclose(manual, full_sample)  # the check above can tell the two apart
    closest = cand[int(np.argmin(manual))]
    assert payloads["sp500"]["analogs"][0]["window"]["end"] == bank.dates[closest].date().isoformat()


def test_sp500_setups_use_daily_closes_and_tags(v2_frame, payloads):
    from regime.analytics import SP500_DAILY_SOURCE

    assert P2.SP90_SOURCE == SP500_DAILY_SOURCE and P2.SOURCE_CODES[SP500_DAILY_SOURCE] == "sp500"
    weekly = P2.bank_for(v2_frame, "sp500")
    assert weekly.cfg.resolution == "W" and weekly.dates[0] == pd.Timestamp("1927-12-30", tz=UTC)
    codes: dict[str | None, list[pd.Timestamp]] = {}
    for j in np.flatnonzero(weekly.valid_win):
        codes.setdefault(P2._source_code(weekly, int(j)), []).append(weekly.dates[int(j)])
    assert set(codes) == {"sp90", "sp500"}  # the Cowles index never enters the setup library
    assert max(codes["sp90"]) < P2.SP500_LAUNCH <= min(codes["sp500"])
    payload = payloads["sp500"]
    assert payload["basis"] == "weekly_close" and payload["outlook"]["usual_since_year"] == 1928
    assert payload["history_start"] == "1871-01-01"  # the first real observation, not the first week
    for a in payload["analogs"]:
        assert a["window"]["start"] >= "1927-12-30"
        assert a["source"] == ("sp90" if a["window"]["end"] < "1957-03-04" else "sp500")
    monthly = P2.bank_for(v2_frame, "sp500", P2.MIRROR["sp500"])
    mirror_codes = {P2._source_code(monthly, int(j)) for j in np.flatnonzero(monthly.valid_win)}
    assert mirror_codes == {"cowles", "sp90", "sp500"}  # Cowles only on the mirror's monthly bank
    assert payload["mirror"]["exact"]["window"]["end"] < "1927-12-30"
    for other in ("nifty", "gold", "bonds", "bitcoin"):
        assert {a["source"] for a in payloads[other]["analogs"]} == {None}


def test_splices_are_chained_not_jumps(v2_frame):
    monthly = P2.bank_for(v2_frame, "sp500", P2.MIRROR["sp500"])
    months = [d.strftime("%Y-%m") for d in monthly.dates]
    for month in ("1927-12", "1928-01"):
        k = months.index(month)
        assert abs(monthly.x[k] - monthly.x[k - 1]) < 0.15  # the daily closes sit at half the Cowles level


def test_gap_is_a_break_not_a_window(v2_frame):
    gap_start, gap_end = pd.Timestamp("1990-01-01", tz=UTC), pd.Timestamp("1991-12-31", tz=UTC)
    holed = v2_frame.copy()
    holed.loc[(holed.index >= gap_start) & (holed.index <= gap_end), "bond_proxy"] = np.nan  # a hole, not filled
    bank = P2.bank_for(holed, "bonds")
    L, H = bank.cfg.window, bank.cfg.horizon
    assert len(np.unique(bank.seg[np.isfinite(bank.seg)])) == 2  # a new segment after the hole
    for k in range(bank.n):
        if bank.valid_win[k]:
            assert not (bank.dates[k - L] < gap_start and bank.dates[k] > gap_end)
        if bank.valid_fwd[k]:
            assert not (bank.dates[k] < gap_start and bank.dates[k + H] > gap_end)
    payload = P2.build_engine_payload(holed, "bonds")
    for a in payload["analogs"]:
        assert not (a["window"]["start"] < "1990-01-01" and a["forward"]["end"] > "1991-12-31")
    PatternEngineV2.model_validate(payload)


def test_mirror_is_1440_months_back_on_the_monthly_bank(v2_frame, payloads):
    mirror = payloads["sp500"]["mirror"]
    assert mirror["available"] is True and mirror["reason"] is None and mirror["basis"] == "monthly_average"
    monthly = P2.bank_for(v2_frame, "sp500", P2.MIRROR["sp500"])
    i = int(np.flatnonzero(monthly.valid_win)[-1])
    exact_end = _bank_index(monthly, mirror["exact"]["window"]["end"])
    assert i - exact_end == 1440 and _months_between(mirror["exact"]["window"]["end"], payloads["sp500"]["as_of"]) == 1440
    assert mirror["exact"]["of"] == len(P2.eligible(monthly, i))
    aligned = mirror["aligned"]
    assert 110 <= aligned["offset_years"] <= 130 and aligned["band_years"] == [110, 130] and aligned["windows_in_band"] > 200
    assert mirror["evidence"]["verdict"] == "no_information"  # from the skill artifact
    early = P2.build_engine_payload(v2_frame.loc[: pd.Timestamp("1961-06-30", tz=UTC)], "sp500")  # empty band
    assert early["status"] == "ok" and early["mirror"]["available"] is False
    assert early["mirror"]["aligned"] is None and early["mirror"]["exact"] is None
    PatternEngineV2.model_validate(early)


def test_short_history_has_no_mirror_and_no_fallback(payloads):
    nifty = payloads["nifty"]
    assert nifty["mirror"]["available"] is False and nifty["mirror"]["reason"] == "history_too_short"
    assert nifty["mirror"]["exact"] is None and nifty["mirror"]["aligned"] is None
    assert nifty["mirror"]["basis"] is None and nifty["mirror"]["evidence"] is None
    assert nifty["history_start"] == "2007-09-17"


def test_trailing_fill_is_cut(payloads):
    for asset in ("sp500", "nifty", "bonds", "bitcoin"):
        assert payloads[asset]["as_of"] == "2026-10-23"  # the frame is forward-filled to 2026-10-27
    gold = payloads["gold"]
    assert gold["as_of"] == "2026-09-30" and gold["current"]["end"] == "2026-09-30"  # last published month


def test_flat_windows_never_setups_or_usual(v2_frame, payloads):
    bank = P2.bank_for(v2_frame, "gold")
    peg_end = pd.Timestamp("1968-03-31", tz=UTC)
    H, L = bank.cfg.horizon, bank.cfg.window
    for j in range(bank.n):
        if j + H < bank.n and bank.dates[j + H] <= peg_end:
            assert not bank.valid_fwd[j]  # a pegged forward year is no outcome
        if L <= j and bank.dates[j] <= peg_end:
            assert not bank.valid_win[j]  # a pegged trailing year is no setup
    gold = payloads["gold"]
    assert gold["outlook"]["usual_since_year"] >= 1967  # 1960 if the pegged years counted
    usual = np.flatnonzero(bank.valid_fwd & (np.arange(bank.n) + H <= _bank_index(bank, gold["as_of"])))
    assert gold["outlook"]["usual_windows"] == len(usual)
    assert all(a["window"]["volatility_pct"] > 1.0 for a in gold["analogs"])


def test_insufficient_status(v2_frame):
    short = v2_frame.loc[: pd.Timestamp("2010-12-31", tz=UTC)]
    payload = P2.build_engine_payload(short, "nifty")
    assert payload["status"] == "insufficient" and payload["outlook"] is None
    assert 1 <= len(payload["analogs"]) < 5  # the few setups are still listed
    PatternEngineV2.model_validate(payload)
    json.dumps(payload, allow_nan=False)


def test_unknown_asset_raises_value_error(v2_frame):
    with pytest.raises(ValueError, match="Unknown pattern asset"):
        P2.build_engine_payload(v2_frame, "not-an-asset")


def _dropped_keys(raw: object, kept: object, path: str = "engine") -> list[str]:
    if isinstance(raw, dict) and isinstance(kept, dict):
        missing = [f"{path}.{k}" for k in raw if k not in kept]
        return missing + [m for k in raw if k in kept for m in _dropped_keys(raw[k], kept[k], f"{path}.{k}")]
    if isinstance(raw, list) and isinstance(kept, list):
        return [m for n, (a, b) in enumerate(zip(raw, kept)) for m in _dropped_keys(a, b, f"{path}[{n}]")]
    return []


def test_payload_validates_drops_nothing_and_has_no_probabilities(payloads):
    for asset, payload in payloads.items():
        dumped = PatternEngineV2.model_validate(payload).model_dump()
        assert _dropped_keys(payload, dumped) == []  # the response model drops nothing
        text = json.dumps(payload, allow_nan=False)
        for banned in ('"p_up', '"p_ge_', '"p_dd', '"similarity', '"novelty', '"distance', '"_ts', '"_assets', '"assets'):
            assert banned not in text, (asset, banned)
        usual = payload["outlook"]["usual_paths"]
        n = payload["horizon"]["periods"] + 1
        assert len(usual["q25"]) == len(usual["q50"]) == len(usual["q75"]) == len(payload["outlook"]["median_path"]) == n
        assert all(lo["value"] <= mid["value"] <= hi["value"] for lo, mid, hi in zip(usual["q25"], usual["q50"], usual["q75"]))
        assert {h["months"] for h in payload["outlook"]["horizons"]} == {3, 6, 12}
    skill = payloads["sp500"]["skill"]
    assert skill["available"] is True and skill["stale"] is False
    assert {"placebo", "warnings", "declines", "cadence", "inputs_fingerprint", "generated_at"} <= set(skill)
    assert "mirror_evidence" not in skill and payloads["nifty"]["skill"] == {"available": False}


def test_events_respect_asset_tags(v2_frame, tmp_path):
    months = pd.date_range("1871-01-15", "2026-09-15", freq="MS", tz=UTC) + pd.Timedelta(days=14)
    items = []
    for d in months:
        items.append({"date": d.date().isoformat(), "title": "India only", "category": "Geopolitics", "assets": ["nifty"]})
        items.append({"date": d.date().isoformat(), "title": "Everywhere", "category": "Financial"})
    items.append({"date": "2001-01-01", "title": "Malformed tag", "assets": 7})
    path = tmp_path / "events.json"
    path.write_text(json.dumps(items), encoding="utf-8")
    events = P2.load_events(path)
    assert len(events) == 2 * len(months)  # the malformed tag is skipped, never attached everywhere

    def titles(payload: dict) -> set[str]:
        blocks = list(payload["analogs"]) + [b for b in (payload["mirror"]["exact"], payload["mirror"]["aligned"]) if b]
        return {e["title"] for b in blocks for e in b["events"]}

    for asset in ("sp500", "gold", "bonds"):
        assert titles(P2.build_engine_payload(v2_frame, asset, events=events)) == {"Everywhere"}, asset
    assert titles(P2.build_engine_payload(v2_frame, "nifty", events=events)) == {"Everywhere", "India only"}
    tagged = {e["title"]: e["_assets"] for e in P2.load_events(P2.EVENTS_PATH)}
    for title in ("The Mumbai attacks", "The Satyam accounting scandal", "India's national election result"):
        assert tagged[title] == frozenset({"nifty"})
    assert tagged["Lehman Brothers files for bankruptcy"] is None


def test_skill_doc_missing_corrupt_or_stale_degrades(v2_frame, tmp_path):
    payload = P2.build_engine_payload(v2_frame, "sp500", skill_doc=None)
    assert payload["skill"] == {"available": False} and payload["mirror"]["evidence"] is None
    bad = tmp_path / "skill.json"
    for text in ("{not json", "[]", json.dumps({"engine_version": "patterns-v1", "schema_version": 2, "assets": {}}),
                 json.dumps({"engine_version": "patterns-v2", "schema_version": 1, "assets": {}}),  # round 1
                 json.dumps({"engine_version": "patterns-v2", "schema_version": 2, "assets": []})):
        bad.write_text(text, encoding="utf-8")
        assert P2.load_skill_doc(bad) is None
    assert P2.load_skill_doc(tmp_path / "missing.json") is None

    fingerprint = P2.inputs_fingerprint(v2_frame, "sp500")
    nan = float("nan")
    doc = _skill_doc({"sp500": fingerprint}, ranking={"horizon_months": 3, "rank_corr": nan, "ci95": None,
                                                     "recent_from": "1987-11-13", "verdict": "none"})
    fresh = P2.build_engine_payload(v2_frame, "sp500", skill_doc=doc)["skill"]
    assert fresh["available"] is True and fresh["stale"] is False and fresh["inputs_fingerprint"] == fingerprint
    assert fresh["ranking"]["rank_corr"] is None  # NaN never reaches the response
    assert P2.build_engine_payload(v2_frame, "sp500", skill_doc=_skill_doc({"sp500": "0" * 16}))["skill"]["stale"] is True
    assert P2.build_engine_payload(v2_frame, "sp500", skill_doc=_skill_doc(None))["skill"]["stale"] is True  # cannot vouch

    # A rewrite that leaves the prices alone (a Core Index recompute) keeps the record fresh ...
    recomputed = v2_frame.assign(core_index=12.0, core_index_bucket="calm_bullish")
    assert P2.inputs_fingerprint(recomputed, "sp500") == fingerprint
    assert P2.build_engine_payload(recomputed, "sp500", skill_doc=doc)["skill"]["stale"] is False
    # ... any change to the price inputs marks it stale.
    moved = v2_frame.copy()
    moved.loc[pd.Timestamp("1990-03-01", tz=UTC), "sp500_proxy"] *= 1.001
    relabelled = v2_frame.copy()
    relabelled.loc[pd.Timestamp("1990-03-01", tz=UTC), "sp500_proxy_source"] = "OTHER"
    for changed in (moved, relabelled, v2_frame.iloc[:-1]):
        assert P2.inputs_fingerprint(changed, "sp500") != fingerprint
    assert P2.build_engine_payload(moved, "sp500", skill_doc=doc)["skill"]["stale"] is True
    us_index = v2_frame.copy()
    us_index.index = us_index.index.as_unit("us")
    assert P2.inputs_fingerprint(us_index, "sp500") == fingerprint  # the parquet stores microseconds


def test_engine_for_caches_files_and_never_raises(v2_frame, tmp_path, monkeypatch, caplog):
    skill = tmp_path / P2.SKILL_FILENAME
    assert P2.skill_stamp(skill) == "none"
    first = P2.engine_for(v2_frame, "sp500", skill_path=skill)
    assert first is not None and first["skill"] == {"available": False}
    skill.write_text(json.dumps(_skill_doc({"sp500": P2.inputs_fingerprint(v2_frame, "sp500")})), encoding="utf-8")
    assert P2.skill_stamp(skill) != "none"
    second = P2.engine_for(v2_frame, "sp500", skill_path=skill)
    assert second["skill"]["available"] is True and second["skill"]["stale"] is False
    assert second["mirror"]["evidence"]["months_tested"] == 418

    monkeypatch.setattr(P2, "build_engine_payload", lambda *args, **kwargs: {"version": "patterns-v2"})
    with caplog.at_level("ERROR"):
        assert P2.engine_for(v2_frame, "sp500", skill_path=skill) is None  # breaks the contract: None, logged
    assert "Study of Patterns v2 engine unavailable for sp500" in caplog.text


def test_runtime_budget(v2_frame):
    for asset in V2_ASSETS:
        t = time.perf_counter()
        P2.build_engine_payload(v2_frame, asset)
        assert time.perf_counter() - t < 2.0, asset  # measured 0.05-0.4 s; generous for CI runners


def test_evidence_statistics_are_numpy_only_and_correct():
    a = np.array([1.0, 2.0, 3.0, 4.0, 5.0])
    assert EV.spearman(a, a) == pytest.approx(1.0)
    assert EV.spearman(a, -a) == pytest.approx(-1.0)
    assert math.isnan(EV.spearman(a[:2], a[:2]))
    assert EV.auc(np.array([0.1, 0.4, 0.35, 0.8]), np.array([0, 0, 1, 1])) == pytest.approx(0.75)
    assert EV.auc(np.array([0.2, 0.3]), np.array([1, 1])) is None
    assert EV.brier_skill(np.array([0.5]), np.array([0.5]), np.array([1.0])) == pytest.approx(0.0)
    assert EV.brier_skill(np.array([1.0, 0.0]), np.array([0.5, 0.5]), np.array([1.0, 0.0])) == pytest.approx(1.0)
    assert EV.brier_skill(np.array([0.3]), np.array([0.0]), np.array([0.0])) is None
    assert list(EV.greedy_sep(np.array([10, 12, 30, 31, 50]), 3, 10)) == [10, 30, 50]
    # Falls read at their first -10% close; a fall ends at a new peak or a 20% rally off the trough.
    v = np.array([1.0, 0.95, 0.89, 0.85, 0.95, 1.01, 0.90, 0.79, 0.80, 0.97, 0.99, 0.85])
    found = [(d["peak"], d["hit"], d["trough"], d["end"], round(d["depth"], 4)) for d in EV.declines(v)]
    assert found == [(0, 2, 3, 5, -0.15), (5, 6, 7, 9, round(0.79 / 1.01 - 1, 4)), (10, 11, 11, None, round(0.85 / 0.99 - 1, 4))]
    for module in (P2, EV):
        source = Path(module.__file__).read_text(encoding="utf-8")
        assert not re.search(r"^\s*(import|from)\s+scipy", source, re.MULTILINE)


def test_evidence_walk_forward_is_causal_and_writes_no_nan(v2_frame):
    bank = P2.bank_for(v2_frame, "nifty")
    df = EV.walk_forward(bank, "nifty")  # asserts max(setup) + H <= i - L on every test
    assert len(df) > 50
    for row in df.itertuples():
        fc = P2.analog_forecast(bank, row.i)
        assert int(fc["chosen"].max()) + bank.cfg.horizon <= row.i - bank.cfg.window
    block = EV.score(df, bank, "nifty")
    assert block["cadence"] == "every_4_weeks" and block["direction"]["base_call"] in {"up", "down", "mixed"}
    assert block["placebo"]["seeds"] == 20 and block["placebo"]["verdict"] in {"same", "setups_worse", "setups_better"}
    assert block["declines"] is None  # only the S&P's weekly bank has a 20-year library for declines
    PatternSkillV2(**block)
    json.dumps(P2.json_safe(block), allow_nan=False)

    sp = P2.bank_for(v2_frame, "sp500")
    record = EV.declines_record(sp, "sp500")
    PatternDeclinesV2(**record)
    assert record["declines"] == record["flagged"] + record["not_flagged"] > 0
    assert record["became_20"] == record["flagged_became_20"] + record["not_flagged_became_20"]
    assert record["before_record"] > 0 and record["period"][0] >= "1949-01-01"  # a 20-year library first


def _strict_json(path: Path) -> dict:
    def reject(constant: str) -> None:
        raise ValueError(f"non-finite number {constant} in {path.name}")

    return json.loads(path.read_text(encoding="utf-8"), parse_constant=reject)


def test_skill_artifact_is_strict_json_and_one_asset_cannot_sink_it(v2_frame, tmp_path):
    nifty_only = v2_frame[["nifty_proxy", "nifty_proxy_source"]]
    path = EV.write_skill_artifact(nifty_only, tmp_path / P2.SKILL_FILENAME)
    doc = _strict_json(path)
    assert doc["schema_version"] == 2 and doc["engine_version"] == "patterns-v2"
    assert doc["inputs_fingerprint"] == {"nifty": P2.inputs_fingerprint(v2_frame, "nifty")}
    assert doc["config"]["sp500"]["sep"] == 52 and doc["config"]["gold"]["sep"] == 12 and "sp500_mirror" in doc["config"]
    assert doc["assets"]["sp500"]["available"] is False and "error" in doc["assets"]["sp500"]
    assert doc["assets"]["nifty"]["available"] is True and doc["assets"]["nifty"]["inputs_fingerprint"] == doc["inputs_fingerprint"]["nifty"]
    PatternSkillV2(**doc["assets"]["nifty"])
    assert P2.load_skill_doc(path) == doc
    assert not path.with_name(path.name + ".tmp").exists()


def test_ingestion_hook_is_never_fatal(v2_frame, tmp_path, monkeypatch):
    from scripts.flows import macro_ingestion

    calls = []

    def fake_writer(frame, path):
        calls.append(Path(path))
        Path(path).write_text("{}", encoding="utf-8")
        return Path(path)

    monkeypatch.setattr(EV, "write_skill_artifact", fake_writer)
    written = macro_ingestion.write_patterns_skill_artifact(v2_frame, tmp_path, data_version="abc123")
    assert written == tmp_path / P2.SKILL_FILENAME and calls == [written]

    def broken(*args, **kwargs):
        raise RuntimeError("simulated evidence failure")

    monkeypatch.setattr(EV, "write_skill_artifact", broken)
    assert macro_ingestion.write_patterns_skill_artifact(v2_frame, tmp_path, data_version="abc123") is None


def test_committed_skill_artifact_matches_the_parquet():
    """A parquet whose price inputs changed without a regenerated skill artifact fails CI.

    Pinned to fingerprints of each asset's price inputs, not to the parquet's
    data_version, so a Core Index recompute does not fail this test.
    """
    parquet = PROCESSED_DIR / "macro_regime_history.parquet"
    skill_path = PROCESSED_DIR / P2.SKILL_FILENAME
    if not parquet.exists():
        pytest.skip("no committed macro artifact in this checkout")
    assert skill_path.exists(), f"{skill_path.name} is missing; regenerate it: {SKILL_COMMAND}"
    doc = _strict_json(skill_path)
    assert P2.load_skill_doc(skill_path) == doc, f"{skill_path.name} is not a patterns-v2 schema 2 artifact; regenerate it: {SKILL_COMMAND}"
    frame = pd.read_parquet(parquet, columns=P2.asset_columns())
    frame.index = pd.to_datetime(frame.index, utc=True)
    frame = frame.sort_index()
    assert set(doc["assets"]) == set(P2.PRIMARY)
    for asset in P2.PRIMARY:
        assert doc["inputs_fingerprint"].get(asset) == P2.inputs_fingerprint(frame, asset), (
            f"{skill_path.name} is stale for {asset}; regenerate it: {SKILL_COMMAND}"
        )
        block = doc["assets"][asset]
        assert block["available"] is True, asset
        PatternSkillV2(**{k: v for k, v in block.items() if k != "mirror_evidence"})
    expected = {a: {"resolution": c.resolution, "window": c.window, "horizon": c.horizon, "k": c.k, "sep": c.sep}
                for a, c in P2.PRIMARY.items()}
    assert {a: doc["config"][a] for a in P2.PRIMARY} == expected, f"configuration changed; regenerate it: {SKILL_COMMAND}"
    sp = doc["assets"]["sp500"]
    PatternMirrorEvidenceV2(**sp["mirror_evidence"])
    PatternDeclinesV2(**sp["declines"])


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


def test_service_engine_is_cached_until_an_input_changes(engine_service, v2_frame, monkeypatch):
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

    # A new skill artifact: rebuilt and fresh, since the parquet's price
    # inputs are the ones it was measured on (the parquet round trip keeps
    # the fingerprint).
    fingerprint = P2.inputs_fingerprint(v2_frame, "sp500")
    engine_service.patterns_skill_path.write_text(json.dumps(_skill_doc({"sp500": fingerprint})), encoding="utf-8")
    with_skill = engine_service.patterns(asset="sp500", today="2026-10-27")["engine"]
    assert calls == ["sp500", "nifty", "sp500"]
    assert with_skill["skill"]["available"] is True and with_skill["skill"]["stale"] is False
    assert with_skill["mirror"]["evidence"]["verdict"] == "no_information"

    # A skill artifact measured on other price inputs is served, marked stale.
    engine_service.patterns_skill_path.write_text(json.dumps(_skill_doc({"sp500": "f" * 16}), indent=1), encoding="utf-8")
    assert engine_service.patterns(asset="sp500", today="2026-10-27")["engine"]["skill"]["stale"] is True
    assert calls == ["sp500", "nifty", "sp500", "sp500"]

    # A rewritten parquet (new mtime) clears the cache.
    artifact = engine_service.artifact_path
    later = artifact.stat().st_mtime + 60
    os.utime(artifact, (later, later))
    engine_service.patterns(asset="sp500", today="2026-10-27")
    assert calls == ["sp500", "nifty", "sp500", "sp500", "sp500"]
    assert set(engine_service._patterns_engine_cache) == {"sp500"}


def test_service_engine_failure_degrades_to_null_and_never_raises(engine_service, monkeypatch, caplog):
    def broken(*args, **kwargs):
        raise RuntimeError("simulated engine failure")

    monkeypatch.setattr(P2, "build_engine_payload", broken)
    with caplog.at_level("ERROR"):
        payload = engine_service.patterns(asset="sp500", today="2026-10-27")
    assert payload["engine"] is None and payload["historical_date"]
    assert "Study of Patterns v2 engine unavailable for sp500" in caplog.text
    assert PatternsResponse(**payload).engine is None

    # A payload that breaks the contract also degrades to null, in the
    # engine and again in the service.
    monkeypatch.setattr(P2, "build_engine_payload", lambda *args, **kwargs: {"version": "patterns-v2"})
    assert engine_service.patterns(asset="sp500", today="2026-10-27")["engine"] is None
    monkeypatch.setattr(P2, "engine_for", lambda *args, **kwargs: {"version": "patterns-v2", "note": float("nan")})
    assert engine_service.patterns(asset="sp500", today="2026-10-27")["engine"] is None
    assert engine_service._patterns_engine_cache == {}  # failures are not cached


def test_patterns_route_answers_200_with_or_without_engine(engine_service, monkeypatch):
    import regime.router as router_module

    monkeypatch.setattr(router_module, "_service", engine_service)
    app = FastAPI()
    app.include_router(router_module.patterns_router, prefix="/api/v1")
    client = TestClient(app)
    ok = client.get("/api/v1/patterns", params={"asset": "sp500"})
    assert ok.status_code == 200
    engine = ok.json()["engine"]
    assert engine["version"] == "patterns-v2" and engine["separation"] == {"periods": 52, "unit": "week"}
    assert engine["outlook"]["usual_windows"] > 0 and engine["mirror"]["basis"] == "monthly_average"
    assert client.get("/api/v1/patterns", params={"asset": "dax"}).status_code == 422

    def broken(*args, **kwargs):
        raise RuntimeError("simulated engine failure")

    monkeypatch.setattr(P2, "build_engine_payload", broken)
    failed = client.get("/api/v1/patterns", params={"asset": "nifty"})
    assert failed.status_code == 200 and failed.json()["engine"] is None
