"""Study of Patterns v2: closest historical setups and what followed them.

Port of the judge's r2 reference (design review, "patterns-v2", judge r2).
pandas/numpy only: CI and the ingestion workflow install
requirements-minimal.txt, and nothing here may need scipy at runtime.

Causality contract (enforced by tests):
* a window's features use only data up to that window's last point;
* a setup is eligible at today's point i only if its whole forward window ends
  by the START of today's window (``j + H <= i - L``), so no setup outcome is
  newer than ``as_of`` and none overlaps today's own trailing year;
* feature scales come from the eligible library at i, never the full sample;
* base rates ("usual") use every valid forward window that ends by i
  (``j + H <= i``);
* skill and mirror evidence are precomputed offline by the walk-forward in
  ``scripts/patterns_v2_evidence.py`` with the same functions, never per
  request.

The configuration (``PRIMARY`` for the setups, ``MIRROR`` for the 120-year
mirror) was fixed before any skill was measured and must not be tuned. Setups
are separated by a full window, so no two of them share a trailing year and
their outcomes are distinct years. The payload reports frequencies ("6 of 10")
beside the usual rate, never blended probabilities.
"""

from __future__ import annotations

import hashlib
import json
import logging
import math
import threading
import warnings
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any, Callable

import numpy as np
import pandas as pd
from numpy.lib.stride_tricks import sliding_window_view

from regime.patterns_v2_schemas import PatternEngineV2

logger = logging.getLogger(__name__)

PATTERNS_V2_VERSION = "patterns-v2"
SKILL_SCHEMA_VERSION = 2
MIRROR_YEARS = 120
MIRROR_BAND_YEARS = (110, 130)
SKILL_FILENAME = "patterns_v2_skill.json"
DEFAULT_SKILL_PATH = Path(__file__).resolve().parents[1] / "data" / "processed" / SKILL_FILENAME
EVENTS_PATH = Path(__file__).with_name("patterns_events.json")

MONTHLY_NATIVE_SOURCES = {
    "M1125AUSM343NNBR",  # NBER/Cowles common-stock index, monthly
    "M1109BUSM293NNBR",  # Dow-Jones industrials, monthly (older artifacts)
    "WORLD_BANK_LBMA_GOLD",  # World Bank Pink Sheet, monthly average
}

# Raw source -> stable display code (the UI whitelists these codes). Any other
# source has no code.
SOURCE_CODES = {
    "M1125AUSM343NNBR": "cowles",
    # Yahoo Finance ^GSPC daily closes (regime.analytics.SP500_DAILY_SOURCE).
    "YAHOO_FINANCE_GSPC": "sp500",
}
# ^GSPC before the S&P 500 launched on 1957-03-04 is its predecessor, the
# S&P 90; points dated before this day carry the code "sp90" instead.
SP90_SOURCE = "YAHOO_FINANCE_GSPC"
SP500_LAUNCH = pd.Timestamp("1957-03-04", tz="UTC")

ASSETS: dict[str, dict[str, str]] = {
    "sp500": {"field": "sp500_proxy", "source_field": "sp500_proxy_source"},
    "nifty": {"field": "nifty_proxy", "source_field": "nifty_proxy_source"},
    "gold": {"field": "gold_proxy", "source_field": "gold_proxy_source"},
    "bonds": {"field": "bond_proxy", "source_field": "bond_proxy_source"},
    "bitcoin": {"field": "btc_proxy", "source_field": "btc_proxy_source"},
}


def asset_columns(frame_columns: Any = None) -> list[str]:
    """The price and source columns the engine reads (optionally only those present)."""
    columns = [c for spec in ASSETS.values() for c in (spec["field"], spec["source_field"])]
    if frame_columns is None:
        return columns
    present = set(frame_columns)
    return [c for c in columns if c in present]


# --------------------------------------------------------------------------
# Configuration (fixed before any skill was measured; do not tune)
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class Config:
    resolution: str = "W"  # "W" weekly closes or "M" monthly averages
    window: int = 52  # trailing window, periods
    horizon: int = 52  # outlook horizon (12 months), periods
    horizons: tuple[int, ...] = (13, 26, 52)  # 3, 6, 12 months
    k: int = 10
    k_min: int = 5
    sep: int = 52  # min distance between setup end points: one full window
    shape_points: int = 13
    shrink_m: float = 5.0  # evidence only (blended probabilities are never shown)
    ref_years: float = 10.0
    daily_native_only: bool = False
    min_sigma_ann: float = 0.01  # drops pegged/flat windows and years (gold before 1968)

    @property
    def periods_per_year(self) -> int:
        return 52 if self.resolution == "W" else 12


def weekly_config(**kw: Any) -> Config:
    return replace(Config(resolution="W", window=52, horizon=52, horizons=(13, 26, 52), sep=52, shape_points=13, daily_native_only=True), **kw)


def monthly_config(**kw: Any) -> Config:
    return replace(Config(resolution="M", window=12, horizon=12, horizons=(3, 6, 12), sep=12, shape_points=12), **kw)


# The setups' banks. The S&P setups use weekly closes of the daily index
# (from 1927-12-30; the S&P 90 until 1957-03-04): outcomes on real closes, and
# the smoothed Cowles monthly index stays out of the setup library.
PRIMARY: dict[str, Config] = {
    "sp500": weekly_config(),
    "nifty": weekly_config(),
    "gold": monthly_config(),
    "bonds": weekly_config(),
    "bitcoin": weekly_config(),
}

# The 120-year mirror's bank: only monthly averages reach back to 1871 (Cowles
# monthly to 1927). 1,440 rows of the full monthly calendar = 120 years.
MIRROR: dict[str, Config] = {"sp500": monthly_config()}


# --------------------------------------------------------------------------
# Series preparation
# --------------------------------------------------------------------------


def chained_daily(frame: pd.DataFrame, asset: str) -> pd.DataFrame:
    """Source-chained daily log level; gaps are breaks; trailing fill cut."""
    spec = ASSETS[asset]
    if spec["field"] not in frame.columns:
        raise ValueError(f"No {asset} history is available")
    price = pd.to_numeric(frame[spec["field"]], errors="coerce")
    price = price.where(price > 0)
    if spec["source_field"] in frame.columns:
        source = frame[spec["source_field"]].astype("string")
    else:
        source = pd.Series("UNKNOWN", index=frame.index, dtype="string")
    valid_values = price.dropna()
    if valid_values.empty:
        raise ValueError(f"No {asset} observations are available")
    changed = valid_values.ne(valid_values.shift())
    last_change = changed[changed].index[-1]
    last_source = str(source.loc[last_change])
    if last_source in MONTHLY_NATIVE_SOURCES:
        cut = (last_change + pd.offsets.MonthEnd(0)).normalize()
        cut = cut.tz_localize("UTC") if cut.tzinfo is None else cut
    else:
        cut = last_change
    price = price.loc[valid_values.index[0] : cut]
    source = source.loc[price.index]
    valid = price.notna()
    prev_valid = valid.shift(1, fill_value=False)
    ret = np.log(price).diff()
    same_source = source.eq(source.shift(1)).fillna(False).astype(bool)
    ret = ret.mask(valid & prev_valid & ~same_source, 0.0)  # chain splices with a zero return
    ret = ret.where(valid & prev_valid)
    segment = (valid & ~prev_valid).cumsum().where(valid)
    level = ret.fillna(0.0).where(valid).groupby(segment).cumsum()
    out = pd.DataFrame(
        {
            "level": level,
            "segment": segment,
            "source": source,
            "monthly_native": source.isin(list(MONTHLY_NATIVE_SOURCES)).fillna(False),
        }
    )
    return out.dropna(subset=["level"])


def resample(daily: pd.DataFrame, cfg: Config) -> pd.DataFrame:
    data = daily
    if cfg.daily_native_only:
        data = data[~data["monthly_native"].astype(bool)]
    if data.empty:
        raise ValueError("No data for the requested resolution")
    if cfg.resolution == "W":
        data = data.assign(obs_date=data.index)
        grouped = data.groupby(pd.Grouper(freq="W-FRI"))
        out = pd.DataFrame(
            {
                "level": grouped["level"].last(),
                "segment": grouped["segment"].last(),
                "source": grouped["source"].last(),
                "date": grouped["obs_date"].max(),
            }
        )
        first, last = out["level"].first_valid_index(), out["level"].last_valid_index()
        out = out.loc[first:last]  # empty weeks stay as NaN rows: index = calendar
    else:
        use = data["monthly_native"].astype(bool) | (data.index.dayofweek < 5)
        data = data[use]
        tmp = data.assign(month=data.index.tz_localize(None).to_period("M"), obs_date=data.index)
        base = tmp.groupby("month")["level"].transform("first")
        tmp = tmp.assign(rel=np.exp(tmp["level"] - base), base=base)
        grouped = tmp.groupby("month")
        out = pd.DataFrame(
            {
                "level": np.log(grouped["rel"].mean()) + grouped["base"].first(),
                "segment": grouped["segment"].last(),
                "source": grouped["source"].last(),
                "date": grouped["obs_date"].max(),
            }
        )
        full = pd.period_range(out.index.min(), out.index.max(), freq="M")
        out = out.reindex(full)  # missing months stay as NaN rows: 1,440 rows = 120 years
        out.index = out.index.to_timestamp(how="end").normalize().tz_localize("UTC")
    out["date"] = pd.to_datetime(out["date"], utc=True)
    out["date"] = out["date"].fillna(pd.Series(out.index, index=out.index))
    return out


# --------------------------------------------------------------------------
# Window bank
# --------------------------------------------------------------------------


@dataclass
class WindowBank:
    cfg: Config
    dates: pd.DatetimeIndex
    x: np.ndarray
    seg: np.ndarray
    source: np.ndarray
    valid_win: np.ndarray
    valid_fwd: np.ndarray
    sigma_ann: np.ndarray
    sigma_ref: np.ndarray
    features: np.ndarray
    weights: np.ndarray
    fwd_ret: dict[int, np.ndarray]
    fwd_path: np.ndarray
    fwd_mdd: np.ndarray
    trail_ret: np.ndarray
    trail_dd: np.ndarray
    trail_path: np.ndarray

    @property
    def n(self) -> int:
        return len(self.x)


def build_bank(resampled: pd.DataFrame, cfg: Config) -> WindowBank:
    x = resampled["level"].to_numpy(dtype=float)
    seg = resampled["segment"].to_numpy(dtype=float)
    dates = pd.DatetimeIndex(resampled["date"])
    n = len(x)
    L, H, P = cfg.window, cfg.horizon, cfg.periods_per_year
    nan_n = lambda: np.full(n, np.nan)  # noqa: E731

    valid_win = np.zeros(n, dtype=bool)
    sigma, trail_ret, trail_dd = nan_n(), nan_n(), nan_n()
    trail_path = np.full((n, L + 1), np.nan)
    if n > L:
        Wv = sliding_window_view(x, L + 1)
        Sv = sliding_window_view(seg, L + 1)
        same = (Sv == Sv[:, :1]).all(axis=1) & np.isfinite(Wv).all(axis=1)
        ends = np.arange(L, n)
        valid_win[ends] = same
        sigma[ends] = np.diff(Wv, axis=1).std(axis=1, ddof=1)
        trail_path[ends] = Wv - Wv[:, :1]
        trail_ret[ends] = Wv[:, -1] - Wv[:, 0]
        trail_dd[ends] = Wv[:, -1] - Wv.max(axis=1)
    sigma_ann = sigma * math.sqrt(P)
    valid_win &= np.nan_to_num(sigma_ann) > cfg.min_sigma_ann

    ref_n = int(round(cfg.ref_years * P))
    s_series = pd.Series(np.where(valid_win, sigma_ann, np.nan))
    sigma_ref = s_series.rolling(ref_n, min_periods=max(3 * P, L)).median().to_numpy()
    sigma_ref = np.where(np.isfinite(sigma_ref), sigma_ref, s_series.expanding(min_periods=1).median().to_numpy())
    valid_win &= np.isfinite(sigma_ref) & (sigma_ref > 0)

    idx = np.unique(np.linspace(0, L, cfg.shape_points + 1).round().astype(int))[1:]
    with np.errstate(invalid="ignore", divide="ignore"), warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)  # all-NaN rows before the first window
        shape = trail_path[:, idx] / (sigma[:, None] * math.sqrt(L))
        ref_L = sigma_ref * math.sqrt(L / P)
        short = max(1, L // 4)
        ret_L = trail_ret / ref_L
        dd_L = trail_dd / ref_L
        vol_regime = np.log(sigma_ann / sigma_ref)
        ma_dist = (trail_path[:, -1] - np.nanmean(trail_path, axis=1)) / ref_L
        ret_short = (trail_path[:, -1] - trail_path[:, L - short]) / (sigma_ref * math.sqrt(short / P))
    state = np.column_stack([ret_L, dd_L, vol_regime, ma_dist, ret_short])
    features = np.column_stack([shape, state])
    weights = np.concatenate([np.full(shape.shape[1], 0.5 / shape.shape[1]), np.full(state.shape[1], 0.5 / state.shape[1])])

    valid_fwd = np.zeros(n, dtype=bool)
    fwd_path = np.full((n, H + 1), np.nan)
    fwd_sigma_ann = nan_n()
    if n > H:
        Fv = sliding_window_view(x, H + 1)
        FSv = sliding_window_view(seg, H + 1)
        okf = (FSv == FSv[:, :1]).all(axis=1) & np.isfinite(Fv).all(axis=1)
        starts = np.arange(0, n - H)
        valid_fwd[starts] = okf
        fwd_path[starts] = Fv - Fv[:, :1]
        fwd_sigma_ann[starts] = np.diff(Fv, axis=1).std(axis=1, ddof=1) * math.sqrt(P)
    # A flat forward year (the gold peg) is no outcome: it never enters the
    # usual rate or the setups.
    valid_fwd &= np.nan_to_num(fwd_sigma_ann) > cfg.min_sigma_ann
    run_max = np.maximum.accumulate(np.nan_to_num(fwd_path, nan=-np.inf), axis=1)
    with np.errstate(invalid="ignore"), warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)  # all-NaN rows (invalid forward windows)
        fwd_mdd = np.nanmin(np.where(np.isfinite(fwd_path), fwd_path - run_max, np.nan), axis=1)
    fwd_mdd[~valid_fwd] = np.nan
    fwd_ret = {h: np.where(valid_fwd, fwd_path[:, h], np.nan) for h in cfg.horizons}
    source = resampled["source"].astype(object).to_numpy()
    return WindowBank(cfg, dates, x, seg, source, valid_win, valid_fwd, sigma_ann, sigma_ref, features, weights,
                      fwd_ret, fwd_path, fwd_mdd, trail_ret, trail_dd, trail_path)


def bank_for(frame: pd.DataFrame, asset: str, cfg: Config | None = None) -> WindowBank:
    cfg = cfg or PRIMARY[asset]
    return build_bank(resample(chained_daily(frame, asset), cfg), cfg)


# --------------------------------------------------------------------------
# Setups and outlook
# --------------------------------------------------------------------------


def eligible(bank: WindowBank, i: int) -> np.ndarray:
    """Setups usable at i: valid windows whose complete forward window ends by
    the START of today's window (j + H <= i - L).

    Ending by i alone would already be causal; ending by i - L also keeps a
    setup's "next 12 months" from being today's own trailing year.
    """
    j = np.arange(bank.n)
    return np.flatnonzero(bank.valid_win & bank.valid_fwd & (j + bank.cfg.horizon <= i - bank.cfg.window))


def distances(bank: WindowBank, i: int, cand: np.ndarray, scale_idx: np.ndarray | None = None) -> np.ndarray:
    F, w = bank.features, bank.weights
    ref = F[cand if scale_idx is None else scale_idx]
    sd = np.nanstd(ref, axis=0)
    sd = np.where(sd > 1e-12, sd, 1.0)
    diff = (F[cand] - F[i]) / sd
    return np.sqrt(np.nansum(w * diff * diff, axis=1))


def pick_analogs(cand: np.ndarray, dist: np.ndarray, k: int, sep: int) -> np.ndarray:
    chosen: list[int] = []
    for pos in np.argsort(dist, kind="stable"):
        j = int(cand[pos])
        if all(abs(j - c) >= sep for c in chosen):
            chosen.append(j)
            if len(chosen) == k:
                break
    return np.array(chosen, dtype=int)


def base_rates(bank: WindowBank, i: int) -> dict[str, Any]:
    cfg = bank.cfg
    j = np.arange(bank.n)
    mask = bank.valid_fwd & (j + cfg.horizon <= i)
    out: dict[str, Any] = {"n": int(mask.sum())}
    if not mask.any():
        return out
    for h in cfg.horizons:
        r = bank.fwd_ret[h][mask]
        out[f"p_up_{h}"] = float((r > 0).mean())
        out[f"median_ret_{h}"] = float(np.median(r))
    mdd = bank.fwd_mdd[mask]
    out["p_dd10"] = float((mdd <= math.log(0.90)).mean())
    out["p_dd20"] = float((mdd <= math.log(0.80)).mean())
    out["median_mdd"] = float(np.median(mdd))
    paths = bank.fwd_path[mask]
    out["path_q25"], out["path_q50"], out["path_q75"] = np.quantile(paths, [0.25, 0.5, 0.75], axis=0)
    return out


def analog_forecast(bank: WindowBank, i: int) -> dict[str, Any] | None:
    """Top-k setups at i and their outcomes; None when fewer than k_min exist."""
    cfg = bank.cfg
    if not bank.valid_win[i]:
        return None
    cand = eligible(bank, i)
    if len(cand) < cfg.k_min:
        return None
    dist = distances(bank, i, cand)
    chosen = pick_analogs(cand, dist, cfg.k, cfg.sep)
    if len(chosen) < cfg.k_min:
        return None
    base = base_rates(bank, i)
    k, m = len(chosen), cfg.shrink_m
    out: dict[str, Any] = {"k": k, "cand": cand, "dist": dist, "chosen": chosen, "base": base}
    pos = {int(c): p for p, c in enumerate(cand)}
    out["chosen_dist"] = np.array([dist[pos[int(c)]] for c in chosen])
    for h in cfg.horizons:
        r = bank.fwd_ret[h][chosen]
        out[f"higher_{h}"] = int((r > 0).sum())
        out[f"share_up_{h}"] = float((r > 0).mean())
        out[f"p_up_{h}"] = (float((r > 0).sum()) + m * base[f"p_up_{h}"]) / (k + m)  # evidence only
        out[f"median_ret_{h}"] = float(np.median(r))
    mdd = bank.fwd_mdd[chosen]
    out["fell_10"] = int((mdd <= math.log(0.90)).sum())
    out["fell_20"] = int((mdd <= math.log(0.80)).sum())
    out["p_dd10"] = (out["fell_10"] + m * base["p_dd10"]) / (k + m)  # evidence only
    out["p_dd20"] = (out["fell_20"] + m * base["p_dd20"]) / (k + m)  # evidence only
    out["median_mdd"] = float(np.median(mdd))
    out["worst_mdd"] = float(np.min(mdd))
    out["path_q50"] = np.quantile(bank.fwd_path[chosen], 0.5, axis=0)
    return out


# --------------------------------------------------------------------------
# Payload helpers
# --------------------------------------------------------------------------


def json_safe(value: Any) -> Any:
    """Recursively replace NaN/inf with None and numpy scalars with Python ones.

    FastAPI serialises responses with ``allow_nan=False``: one NaN anywhere in
    the payload would turn the whole /patterns response into a 500.
    """
    if isinstance(value, np.generic):
        value = value.item()
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, dict):
        return {key: json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_safe(item) for item in value]
    return value


def inputs_fingerprint(frame: pd.DataFrame, asset: str) -> str:
    """A 16-hex fingerprint of the asset's price inputs (value and source columns).

    SHA-256 over the non-null rows' UTC timestamps in ns, their float64 values
    rounded to 8 decimals and their source strings joined by U+001F. Shared by
    this module (the skill record's ``stale`` flag) and the evidence generator,
    so a parquet rewrite that leaves the prices alone (a Core Index recompute)
    does not mark the record stale.
    """
    spec = ASSETS[asset]
    if spec["field"] not in frame.columns:
        raise ValueError(f"No {asset} history is available")
    values = pd.to_numeric(frame[spec["field"]], errors="coerce")
    ok = values.notna().to_numpy()
    if spec["source_field"] in frame.columns:
        sources = frame[spec["source_field"]].astype("string").fillna("")
    else:
        sources = pd.Series("", index=frame.index, dtype="string")
    index = pd.DatetimeIndex(frame.index)
    index = index.tz_localize("UTC") if index.tz is None else index.tz_convert("UTC")
    digest = hashlib.sha256()
    digest.update(np.asarray(index[ok].as_unit("ns").asi8, dtype=np.int64).tobytes())
    digest.update(np.round(values.to_numpy(dtype=float)[ok], 8).tobytes())
    digest.update("\x1f".join(sources.to_numpy(dtype=object)[ok].tolist()).encode("utf-8"))
    return digest.hexdigest()[:16]


def _pct(log_value: float) -> float | None:
    if log_value is None or not np.isfinite(log_value):
        return None
    return round(float(np.expm1(log_value) * 100.0), 1)


def _iso(ts: pd.Timestamp) -> str:
    return ts.date().isoformat()


def _label_year(ts: pd.Timestamp) -> int:
    """The calendar year a forward window starting at ts describes (a December start reads as the next year)."""
    return int(ts.year + (1 if ts.month == 12 else 0))


def _rebased(path_log: np.ndarray, dates: pd.DatetimeIndex | list[pd.Timestamp]) -> list[dict[str, Any]]:
    return [
        {"date": _iso(d), "value": round(float(100.0 * math.exp(v)), 2)}
        for d, v in zip(dates, path_log)
        if np.isfinite(v)
    ]


def _window(bank: WindowBank, j: int) -> dict[str, Any]:
    L = bank.cfg.window
    return {
        "start": _iso(bank.dates[j - L]),
        "end": _iso(bank.dates[j]),
        "return_pct": _pct(bank.trail_ret[j]),
        "drawdown_pct": _pct(bank.trail_dd[j]),
        "volatility_pct": None if not np.isfinite(bank.sigma_ann[j]) else round(float(bank.sigma_ann[j] * 100), 1),
        "path": _rebased(bank.trail_path[j], bank.dates[j - L : j + 1]),
    }


def _forward(bank: WindowBank, j: int) -> dict[str, Any]:
    cfg = bank.cfg
    H = cfg.horizon
    out = {
        "start": _iso(bank.dates[j]),
        "end": _iso(bank.dates[j + H]),
        "max_drawdown_pct": _pct(bank.fwd_mdd[j]),
        "path": _rebased(bank.fwd_path[j], bank.dates[j : j + H + 1]),
    }
    for h, name in zip(cfg.horizons, ("3m", "6m", "12m")):
        out[f"return_{name}_pct"] = _pct(bank.fwd_ret[h][j])
    return out


def _source_code(bank: WindowBank, j: int) -> str | None:
    raw = bank.source[j]
    if raw is None or (isinstance(raw, float) and not np.isfinite(raw)) or raw is pd.NA:
        return None
    raw = str(raw)
    if raw == SP90_SOURCE and bank.dates[j] < SP500_LAUNCH:
        return "sp90"
    return SOURCE_CODES.get(raw)


def _rank_fields(dist_sorted: np.ndarray, d: float) -> dict[str, Any]:
    of = int(len(dist_sorted))
    position = int(np.searchsorted(dist_sorted, d, side="left")) + 1
    # Always < 100: rounding must not turn the closest of 5,002 (99.98) into 100.0.
    closer = min(round(100.0 * (of - position) / of, 1), 99.9)
    return {"position": position, "of": of, "closer_than_pct": closer}


def load_events(path: Path) -> list[dict[str, Any]]:
    """The editorial events; an optional ``assets`` list limits an event to those assets."""
    try:
        payload = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    if not isinstance(payload, list):
        return []
    out = []
    for item in payload:
        if not isinstance(item, dict) or not isinstance(item.get("date"), str) or not item.get("title"):
            continue
        tags = item.get("assets")
        if isinstance(tags, str):
            tags = [tags]
        if tags is not None and not (isinstance(tags, list) and all(isinstance(t, str) for t in tags)):
            continue  # a malformed tag must not attach the event everywhere
        try:
            d = pd.Timestamp(item["date"], tz="UTC")
        except (TypeError, ValueError):
            continue
        out.append({
            "date": _iso(d),
            "title": str(item["title"]),
            "category": str(item.get("category") or "Historical"),
            "summary": str(item.get("summary") or ""),
            "source": str(item.get("source") or "Editorial dictionary"),
            "_ts": d,
            "_assets": None if tags is None else frozenset(tags),
        })
    return out


def _events_between(events: list[dict[str, Any]], asset: str, start: pd.Timestamp, end: pd.Timestamp) -> list[dict[str, Any]]:
    hits = [
        {k: v for k, v in e.items() if not k.startswith("_")}
        for e in events
        if start <= e["_ts"] <= end and (e["_assets"] is None or asset in e["_assets"])
    ]
    return sorted(hits, key=lambda e: e["date"])


def _skill_block(asset: str, skill_doc: dict[str, Any] | None, fingerprint: str) -> dict[str, Any]:
    """The artifact's record for ``asset``; stale when it was measured on other price inputs."""
    if not isinstance(skill_doc, dict) or not isinstance(skill_doc.get("assets"), dict):
        return {"available": False}
    block = skill_doc["assets"].get(asset)
    if not isinstance(block, dict) or not block.get("available"):
        return {"available": False}
    out = {k: v for k, v in block.items() if k not in ("mirror_evidence", "error")}
    recorded = skill_doc.get("inputs_fingerprint")
    recorded = recorded.get(asset) if isinstance(recorded, dict) else None
    recorded = recorded if isinstance(recorded, str) else block.get("inputs_fingerprint")
    out["generated_at"] = skill_doc.get("generated_at")
    out["inputs_fingerprint"] = recorded if isinstance(recorded, str) else None
    out["stale"] = out["inputs_fingerprint"] != fingerprint
    return out


# --------------------------------------------------------------------------
# Payload
# --------------------------------------------------------------------------


def build_engine_payload(
    frame: pd.DataFrame,
    asset: str,
    *,
    skill_doc: dict[str, Any] | None = None,
    events: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """The ``engine`` block of /api/v1/patterns for the latest data (NaN-free).

    Raises ValueError for an unknown asset or a series without one complete
    window; ``engine_for`` turns any exception into None.
    """
    if asset not in ASSETS:
        raise ValueError(f"Unknown pattern asset: {asset}")
    payload = _engine_payload(frame, asset, skill_doc=skill_doc, events=events or [])
    return json_safe(payload)


def _engine_payload(
    frame: pd.DataFrame,
    asset: str,
    *,
    skill_doc: dict[str, Any] | None,
    events: list[dict[str, Any]],
) -> dict[str, Any]:
    cfg = PRIMARY[asset]
    daily = chained_daily(frame, asset)
    bank = build_bank(resample(daily, cfg), cfg)
    valid_idx = np.flatnonzero(bank.valid_win)
    if len(valid_idx) == 0:
        raise ValueError(f"No complete {asset} window is available")
    i = int(valid_idx[-1])
    P, L, H = cfg.periods_per_year, cfg.window, cfg.horizon
    unit = "week" if cfg.resolution == "W" else "month"
    current = _window(bank, i)
    current["vol_vs_10y"] = None if not np.isfinite(bank.sigma_ref[i]) else round(float(bank.sigma_ann[i] / bank.sigma_ref[i]), 2)
    payload: dict[str, Any] = {
        "version": PATTERNS_V2_VERSION,
        "status": "ok",
        "asset": asset,
        "as_of": _iso(bank.dates[i]),
        "history_start": _iso(daily.index[0]),  # first real observation, any basis
        "resolution": cfg.resolution,
        "basis": "weekly_close" if cfg.resolution == "W" else "monthly_average",
        "window": {"periods": L, "unit": unit},
        "horizon": {"periods": H, "unit": unit},
        "separation": {"periods": cfg.sep, "unit": unit},
        "current": current,
        "analogs": [],
        "outlook": None,
        "mirror": _mirror(daily, asset, skill_doc=skill_doc, events=events),
        "skill": _skill_block(asset, skill_doc, inputs_fingerprint(frame, asset)),
    }

    fc = analog_forecast(bank, i)
    if fc is None:
        payload["status"] = "insufficient"
        cand = eligible(bank, i)
        if len(cand):
            dist = distances(bank, i, cand)
            chosen = pick_analogs(cand, dist, cfg.k, cfg.sep)
            dsorted = np.sort(dist)
            pos = {int(c): p for p, c in enumerate(cand)}
            for rank, j in enumerate(chosen, start=1):
                payload["analogs"].append(_analog(bank, asset, int(j), rank, dsorted, float(dist[pos[int(j)]]), events))
        return payload

    cand, dist = fc["cand"], fc["dist"]
    dsorted = np.sort(dist)
    for rank, (j, d) in enumerate(zip(fc["chosen"], fc["chosen_dist"]), start=1):
        payload["analogs"].append(_analog(bank, asset, int(j), rank, dsorted, float(d), events))

    base = fc["base"]
    usual = np.flatnonzero(bank.valid_fwd & (np.arange(bank.n) + H <= i))
    step_days = 365.25 / P
    future = [bank.dates[i] + pd.Timedelta(days=step_days * s) for s in range(H + 1)]
    payload["outlook"] = {
        "k": fc["k"],
        "library_windows": int(len(cand)),
        "library_span": [_iso(bank.dates[int(cand[0]) - L]), _iso(bank.dates[int(cand[-1])])],
        "usual_windows": int(base["n"]),
        "usual_since_year": _label_year(bank.dates[int(usual[0])]),
        "horizons": [
            {
                "months": months,
                "higher": fc[f"higher_{h}"],
                "of": fc["k"],
                "base_share_up_pct": round(base[f"p_up_{h}"] * 100, 1),
                "median_return_pct": _pct(fc[f"median_ret_{h}"]),
                "base_median_return_pct": _pct(base[f"median_ret_{h}"]),
            }
            for h, months in zip(cfg.horizons, (3, 6, 12))
        ],
        "median_path": _rebased(fc["path_q50"], future),
        "usual_paths": {
            "q25": _rebased(base["path_q25"], future),
            "q50": _rebased(base["path_q50"], future),
            "q75": _rebased(base["path_q75"], future),
        },
        "drawdown": {
            "fell_10": fc["fell_10"],
            "fell_20": fc["fell_20"],
            "of": fc["k"],
            "median_pct": _pct(fc["median_mdd"]),
            "worst_pct": _pct(fc["worst_mdd"]),
            "base_share_10_pct": round(base["p_dd10"] * 100, 1),
            "base_share_20_pct": round(base["p_dd20"] * 100, 1),
            "base_median_pct": _pct(base["median_mdd"]),
        },
    }
    return payload


def _mirror(
    daily: pd.DataFrame,
    asset: str,
    *,
    skill_doc: dict[str, Any] | None,
    events: list[dict[str, Any]],
) -> dict[str, Any]:
    """The 120-year mirror on the asset's own mirror bank (monthly averages for the S&P).

    Only where the series reaches back far enough: no fallback window.
    """
    mirror: dict[str, Any] = {
        "available": False,
        "reason": "history_too_short",
        "offset_years": MIRROR_YEARS,
        "basis": None,
        "exact": None,
        "aligned": None,
        "evidence": None,
    }
    cfg = MIRROR.get(asset)
    if cfg is None:
        return mirror
    mirror["basis"] = "weekly_close" if cfg.resolution == "W" else "monthly_average"
    bank = build_bank(resample(daily, cfg), cfg)
    valid_idx = np.flatnonzero(bank.valid_win)
    if len(valid_idx) == 0:
        return mirror
    i = int(valid_idx[-1])
    cand = eligible(bank, i)
    if len(cand) < cfg.k_min:
        return mirror
    P, L, H = cfg.periods_per_year, cfg.window, cfg.horizon
    dsorted = np.sort(distances(bank, i, cand))
    first_point = int(np.flatnonzero(np.isfinite(bank.x))[0])
    j = i - MIRROR_YEARS * P
    if j < first_point or j < L:
        return mirror
    if bank.valid_win[j] and j + H <= i and bank.valid_fwd[j]:
        dj = float(distances(bank, i, np.array([j]), scale_idx=cand)[0])
        mirror["exact"] = {
            **_rank_fields(dsorted, dj),
            "window": _window(bank, j),
            "forward": _forward(bank, j),
            "events": _events_between(events, asset, bank.dates[j - L], bank.dates[j + H]),
        }
        mirror["available"] = True
        mirror["reason"] = None
    else:
        mirror["reason"] = "window_unavailable"
    lo, hi = i - MIRROR_BAND_YEARS[1] * P, i - MIRROR_BAND_YEARS[0] * P
    band = cand[(cand >= lo) & (cand <= hi)]
    if len(band):
        db = distances(bank, i, band, scale_idx=cand)
        ja = int(band[int(np.argmin(db))])
        mirror["aligned"] = {
            **_rank_fields(dsorted, float(db.min())),
            "offset_years": round((i - ja) / P, 2),
            "band_years": list(MIRROR_BAND_YEARS),
            "windows_in_band": int(len(band)),
            "window": _window(bank, ja),
            "forward": _forward(bank, ja),
            "events": _events_between(events, asset, bank.dates[ja - L], bank.dates[ja + H]),
        }
    if mirror["available"] and isinstance(skill_doc, dict) and isinstance(skill_doc.get("assets"), dict):
        ev = (skill_doc["assets"].get(asset) or {}).get("mirror_evidence")
        mirror["evidence"] = ev if isinstance(ev, dict) else None
    return mirror


def _analog(
    bank: WindowBank,
    asset: str,
    j: int,
    rank: int,
    dsorted: np.ndarray,
    d: float,
    events: list[dict[str, Any]],
) -> dict[str, Any]:
    cfg = bank.cfg
    return {
        "rank": rank,
        **_rank_fields(dsorted, d),
        "source": _source_code(bank, j),
        "window": _window(bank, j),
        "forward": _forward(bank, j),
        "events": _events_between(events, asset, bank.dates[j - cfg.window], bank.dates[j + cfg.horizon]),
    }


# --------------------------------------------------------------------------
# Skill artifact and the cached, never-raising entry point
# --------------------------------------------------------------------------


def load_skill_doc(path: Path) -> dict[str, Any] | None:
    """The parsed skill artifact, or None when missing, unreadable or of another engine/schema."""
    try:
        doc = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(doc, dict) or doc.get("engine_version") != PATTERNS_V2_VERSION:
        return None
    if doc.get("schema_version") != SKILL_SCHEMA_VERSION or not isinstance(doc.get("assets"), dict):
        return None
    return doc


def _file_stamp(path: Path) -> str:
    try:
        stat = Path(path).stat()
    except OSError:
        return "none"
    return f"{stat.st_mtime_ns}-{stat.st_size}"


def skill_stamp(path: Path | str | None = None) -> str:
    """mtime_ns and size of the skill artifact, or "none" when it is missing."""
    return _file_stamp(Path(path) if path is not None else DEFAULT_SKILL_PATH)


_file_cache: dict[tuple[str, str], tuple[str, Any]] = {}
_file_cache_lock = threading.Lock()


def _cached_file(kind: str, path: Path, loader: Callable[[Path], Any]) -> Any:
    """``loader(path)``, re-read only when the file's stamp changes (loaders never raise)."""
    stamp = _file_stamp(path)
    key = (kind, str(path))
    with _file_cache_lock:
        hit = _file_cache.get(key)
    if hit is not None and hit[0] == stamp:
        return hit[1]
    value = loader(path)
    with _file_cache_lock:
        _file_cache[key] = (stamp, value)
    return value


def engine_for(
    frame: pd.DataFrame,
    asset: str,
    *,
    skill_path: Path | str | None = None,
    events_path: Path | str | None = None,
) -> dict[str, Any] | None:
    """The validated, NaN-free engine block for ``asset``; None (logged) on any failure.

    Loads the mtime-cached skill artifact and events, builds, validates with
    ``PatternEngineV2`` and checks strict JSON. Never raises: the v2 block must
    never fail a /patterns request.
    """
    try:
        skill_doc = _cached_file("skill", Path(skill_path) if skill_path is not None else DEFAULT_SKILL_PATH, load_skill_doc)
        events = _cached_file("events", Path(events_path) if events_path is not None else EVENTS_PATH, load_events)
        payload = build_engine_payload(frame, asset, skill_doc=skill_doc, events=events)
        PatternEngineV2.model_validate(payload)
        json.dumps(payload, allow_nan=False)
    except Exception:  # noqa: BLE001 - the v2 block must never fail the request
        logger.exception("Study of Patterns v2 engine unavailable for %s", asset)
        return None
    return payload
