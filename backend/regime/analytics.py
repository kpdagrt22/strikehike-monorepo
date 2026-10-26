"""Shared macro-regime analytics.

Everything in this module is pure: it accepts a daily, forward-filled FRED
frame and returns derived columns or API-ready objects. The ingestion pipeline
and the read API both import these functions so the NBER mapping, the crash
windows and the strength meter cannot drift between the two surfaces.

Method notes
------------
* NBER labels are monthly and retrospective. ``USREC`` is forward-filled onto
  the daily calendar; a crash window is therefore month-precise, not day-precise.
* The strength meter is a V1 heuristic, not a probability and not a forecast.
  It uses a 1y/3y moving-average crossover on the Fed Funds rate and a
  level + 3m/1y crossover on the 10y-2y curve. Weights are fixed and unvalidated.
* ``USREC`` is deliberately excluded from every strength input. Using the label
  to build the score would leak the target into the feature.
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

STRENGTH_VERSION = "v1-ma-crossover"
STRENGTH_WEIGHTS: dict[str, float] = {
    "fed_score": 0.55,
    "curve_score": 0.45,
}

# Well-known NBER peaks. The key is the first recession month from USREC.
# Any episode not listed falls back to "Recession of YYYY".
CRASH_NAMES: dict[str, str] = {
    "1857-06": "Panic of 1857",
    "1860-10": "Civil War recession",
    "1865-04": "Post-Civil War recession",
    "1869-06": "Recession of 1869-70",
    "1873-10": "Long Depression",
    "1882-03": "Recession of 1882-85",
    "1885-03": "Recession of 1885",
    "1887-03": "Recession of 1887-88",
    "1890-07": "Recession of 1890-91",
    "1893-01": "Panic of 1893",
    "1895-12": "Recession of 1895-97",
    "1899-06": "Recession of 1899-1900",
    "1902-09": "Recession of 1902-04",
    "1907-05": "Panic of 1907",
    "1910-01": "Recession of 1910-12",
    "1913-01": "Recession of 1913-14",
    "1918-08": "Post-WWI recession",
    "1920-01": "Depression of 1920-21",
    "1923-05": "Recession of 1923-24",
    "1926-10": "Recession of 1926-27",
    "1929-08": "Great Depression",
    "1937-05": "Recession of 1937-38",
    "1945-02": "Post-WWII demobilisation",
    "1948-11": "Recession of 1948-49",
    "1953-07": "Recession of 1953",
    "1957-08": "Recession of 1957-58",
    "1960-04": "Recession of 1960-61",
    "1969-12": "Recession of 1969-70",
    "1973-11": "Oil shock",
    "1980-01": "Volcker shock",
    "1981-07": "Volcker recession",
    "1990-07": "Gulf War recession",
    "2001-03": "Dot-Com bust",
    "2007-12": "Global Financial Crisis (Lehman)",
    "2020-02": "COVID-19 shock",
}


# ---------------------------------------------------------------------------
# Small value helpers
# ---------------------------------------------------------------------------


def _as_float(value: Any, digits: int | None = None) -> float | None:
    if value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not np.isfinite(number):
        return None
    return round(number, digits) if digits is not None else number


def _as_int(value: Any) -> int | None:
    number = _as_float(value)
    return int(number) if number is not None else None


def _as_str(value: Any) -> str | None:
    if value is None:
        return None
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass
    return str(value)


def _scale(series: pd.Series, low: float, high: float) -> pd.Series:
    """Linearly map ``series`` onto 0..100 and clip the tails."""
    if high <= low:
        raise ValueError("high must be greater than low")
    return ((series - low) / (high - low) * 100.0).clip(0.0, 100.0)


def _first_present(frame: pd.DataFrame, names: tuple[str, ...]) -> pd.Series | None:
    for name in names:
        if name in frame.columns:
            series = frame[name]
            if series.notna().any():
                return series
    return None


def _nan_series(index: pd.Index, name: str) -> pd.Series:
    return pd.Series(np.nan, index=index, name=name, dtype="float64")


# ---------------------------------------------------------------------------
# Macro strength meter (V1)
# ---------------------------------------------------------------------------


def calculate_macro_strength_components(frame: pd.DataFrame) -> pd.DataFrame:
    """Return the strength score plus its auditable components.

    Fed component: 1-year vs 3-year moving average of the effective Fed Funds
    rate. Fast below slow (policy easing) scores high; fast above slow scores low.

    Curve component: 60% level score (a -2% curve scores 0, +2% scores 100) and
    40% 3-month vs 12-month moving-average crossover. Inversion is exposed as a
    boolean alongside the score.

    The composite is a weighted average of whichever components are available;
    ``macro_strength_coverage`` reports how much of the weight is populated.
    """
    out = pd.DataFrame(index=frame.index)

    fed = _first_present(frame, ("FEDFUNDS", "DFF"))
    if fed is None:
        fed = _nan_series(frame.index, "FEDFUNDS")

    curve = _first_present(frame, ("T10Y2Y",))
    if curve is None and {"DGS10", "DGS2"}.issubset(frame.columns):
        curve = frame["DGS10"] - frame["DGS2"]
    if curve is None:
        curve = _first_present(frame, ("T10Y3M",))
    if curve is None:
        curve = _nan_series(frame.index, "T10Y2Y")

    # Fed Funds crossover.
    out["fed_fast_ma"] = fed.rolling(252, min_periods=252).mean()
    out["fed_slow_ma"] = fed.rolling(756, min_periods=756).mean()
    out["fed_cross"] = out["fed_fast_ma"] - out["fed_slow_ma"]
    # Fast 1pp above slow => 0 (tightening); 1pp below => 100 (easing).
    out["fed_score"] = 100.0 - _scale(out["fed_cross"], -1.0, 1.0)

    # Yield-curve level and crossover.
    out["curve_fast_ma"] = curve.rolling(63, min_periods=63).mean()
    out["curve_slow_ma"] = curve.rolling(252, min_periods=252).mean()
    out["curve_cross"] = out["curve_fast_ma"] - out["curve_slow_ma"]
    out["curve_level_score"] = _scale(curve, -2.0, 2.0)
    out["curve_cross_score"] = _scale(out["curve_cross"], -0.5, 0.5)
    out["curve_score"] = (
        0.60 * out["curve_level_score"] + 0.40 * out["curve_cross_score"]
    )

    inverted = pd.Series(pd.NA, index=frame.index, dtype="boolean")
    valid_curve = curve.notna()
    inverted.loc[valid_curve] = curve.loc[valid_curve].lt(0.0)
    out["curve_inverted"] = inverted

    score_columns = list(STRENGTH_WEIGHTS)
    weights = pd.Series(STRENGTH_WEIGHTS, dtype="float64")
    available = out[score_columns].notna()
    weighted = out[score_columns].fillna(0.0).mul(weights, axis=1).sum(axis=1)
    coverage = available.mul(weights, axis=1).sum(axis=1)

    out["macro_strength"] = weighted.div(coverage.replace(0.0, np.nan))
    out["macro_strength_coverage"] = coverage.clip(0.0, 1.0)

    label = pd.Series(pd.NA, index=frame.index, dtype="string")
    score = out["macro_strength"]
    label.loc[score.ge(60.0)] = "bullish"
    label.loc[score.le(40.0)] = "bearish"
    label.loc[score.gt(40.0) & score.lt(60.0)] = "neutral"
    out["macro_strength_label"] = label

    return out


def calculate_macro_strength(frame: pd.DataFrame) -> pd.Series:
    """Return the 0-100 composite Trend Meter for ``frame``."""
    return calculate_macro_strength_components(frame)["macro_strength"].rename(
        "macro_strength"
    )


# ---------------------------------------------------------------------------
# NBER alignment and crash objects
# ---------------------------------------------------------------------------


def annotate_nber(frame: pd.DataFrame) -> pd.DataFrame:
    """Add nullable NBER recession columns derived from ``USREC``.

    ``nber_episode`` is 0 in expansion, a positive integer in recession, and
    ``<NA>`` before the USREC history begins.
    """
    out = frame.copy()
    if "USREC" not in out.columns:
        return out

    recession = out["USREC"].round().clip(lower=0, upper=1).astype("Int64")
    out["nber_recession"] = recession

    phase = pd.Series(pd.NA, index=out.index, dtype="string")
    phase.loc[recession.eq(1).fillna(False)] = "recession"
    phase.loc[recession.eq(0).fillna(False)] = "expansion"
    out["nber_phase"] = phase

    change = recession.diff()
    start = change.eq(1).fillna(False)
    end = change.eq(-1).fillna(False)
    out["nber_recession_start"] = start.astype(bool)
    out["nber_recession_end"] = end.astype(bool)

    episode = change.eq(1).fillna(False).cumsum()
    out["nber_episode"] = (
        episode.where(recession.eq(1).fillna(False), 0)
        .where(recession.notna(), pd.NA)
        .astype("Int64")
    )
    return out


def crash_name(start: pd.Timestamp) -> str:
    return CRASH_NAMES.get(start.strftime("%Y-%m"), f"Recession of {start.year}")


def nber_episodes(frame: pd.DataFrame) -> list[dict[str, Any]]:
    """Return contiguous USREC recession runs with month-precise boundaries."""
    if "nber_recession" not in frame.columns:
        return []

    recession = frame["nber_recession"].dropna()
    if recession.empty:
        return []
    recession = recession.astype(int)

    mask = recession.eq(1)
    if not mask.any():
        return []

    groups = mask.ne(mask.shift(fill_value=False)).cumsum()
    episodes: list[dict[str, Any]] = []
    for _, run in recession[mask].groupby(groups[mask]):
        # USREC turns on in the month *following* the NBER peak. The public
        # crash window starts at the peak month; the raw indicator window is
        # kept alongside it so the one-month offset is auditable.
        indicator_start = run.index[0]
        start = indicator_start - pd.DateOffset(months=1)
        end = run.index[-1]
        episodes.append(
            {
                "id": f"nber-{start.strftime('%Y-%m')}",
                "name": crash_name(start),
                "type": "nber_recession",
                "start": start.date().isoformat(),
                "end": end.date().isoformat(),
                "start_month": start.strftime("%Y-%m"),
                "end_month": end.strftime("%Y-%m"),
                "indicator_start": indicator_start.date().isoformat(),
                "indicator_end": end.date().isoformat(),
                "duration_days": int((end - start).days) + 1,
                "date_precision": "month",
                "ongoing": bool(end == recession.index[-1]),
            }
        )
    return episodes


def pre_crash_snapshot(
    frame: pd.DataFrame,
    crash_start: pd.Timestamp,
    months: int,
) -> dict[str, Any]:
    """State of the curve, Fed Funds and strength N months before a crash."""
    target = crash_start - pd.DateOffset(months=months)
    empty = {
        "as_of": None,
        "months_prior": months,
        "t10y2y": None,
        "fed_funds": None,
        "curve_inverted": None,
        "macro_strength": None,
        "sp500_proxy": None,
        "phase": None,
    }
    if frame.empty:
        return empty

    subset = frame.loc[:target]
    if subset.empty:
        return empty

    row = subset.iloc[-1]
    t10y2y = _as_float(row.get("T10Y2Y"), 4)
    fed_funds = _as_float(row.get("FEDFUNDS"), 4)
    if fed_funds is None:
        fed_funds = _as_float(row.get("DFF"), 4)

    return {
        "as_of": row.name.date().isoformat(),
        "months_prior": months,
        "t10y2y": t10y2y,
        "fed_funds": fed_funds,
        "curve_inverted": None if t10y2y is None else bool(t10y2y < 0.0),
        "macro_strength": _as_float(row.get("macro_strength"), 2),
        "sp500_proxy": _as_float(row.get("sp500_proxy"), 2),
        "phase": _as_str(row.get("nber_phase")),
    }


def build_crashes(frame: pd.DataFrame) -> list[dict[str, Any]]:
    """Build the API ``crashes`` array from NBER episodes."""
    crashes: list[dict[str, Any]] = []
    coverage_start = frame.index.min()
    for episode in nber_episodes(frame):
        start = pd.Timestamp(episode["start"], tz="UTC")
        zoom_start = (start - pd.DateOffset(months=6)).date().isoformat()
        crashes.append(
            {
                **episode,
                "within_coverage": bool(start >= coverage_start),
                "zoom_window": {"start": zoom_start, "end": episode["start"]},
                "pre_crash_indicators": {
                    "3m": pre_crash_snapshot(frame, start, 3),
                    "6m": pre_crash_snapshot(frame, start, 6),
                },
            }
        )
    return crashes


# ---------------------------------------------------------------------------
# Long-run equity proxy
# ---------------------------------------------------------------------------


def build_sp500_proxy(
    frame: pd.DataFrame,
    *,
    raw_frame: pd.DataFrame | None = None,
) -> pd.DataFrame:
    """Splice a long-run equity proxy from the best available FRED series.

    Priority is historical first, modern last:

    1. ``M1125AUSM343NNBR`` - Cowles/S&P common-stock index, 1871-1956.
    2. ``M1109BUSM293NNBR`` - Dow-Jones industrial index, 1914-1968.
    3. ``SP500``           - S&P 500, 2016-present.
    4. ``NASDAQCOM``       - Nasdaq composite, 1971-present.

    ``raw_frame`` must contain native-frequency values (NaNs off observation
    dates). Passing the already-forward-filled frame would let the oldest
    source fill the entire 170-year timeline, which is why the ingestion
    pipeline passes the raw merge separately. Each source is filled forward
    only to its own last observation, so source boundaries stay honest.

    Levels are not chained across sources and gaps are preserved. The source
    column tells the frontend which segment it is drawing.
    """
    proxy = pd.Series(np.nan, index=frame.index, name="sp500_proxy", dtype="float64")
    source = pd.Series(pd.NA, index=frame.index, name="sp500_proxy_source", dtype="string")
    source_frame = raw_frame if raw_frame is not None else frame

    for column in (
        "M1125AUSM343NNBR",
        "M1109BUSM293NNBR",
        "SP500",
        "NASDAQCOM",
    ):
        if column not in source_frame.columns:
            continue
        raw = source_frame[column]
        last_valid = raw.last_valid_index()
        if last_valid is None:
            continue
        filled = raw.ffill().loc[:last_valid]
        mask = proxy.isna() & filled.notna()
        proxy.loc[mask] = filled.loc[mask]
        source.loc[mask] = column

    return pd.DataFrame(
        {"sp500_proxy": proxy, "sp500_proxy_source": source},
        index=frame.index,
    )
