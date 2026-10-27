"""Shared macro-regime analytics.

Everything in this module is pure: it accepts a daily, forward-filled FRED
frame and returns derived columns or API-ready objects. The ingestion pipeline
and the read API both import these functions so the NBER mapping, the crash
windows and the strength meter cannot drift between the two surfaces.

Method notes
------------
* NBER labels are monthly and retrospective. ``USREC`` is forward-filled onto
  the daily calendar; a crash window is therefore month-precise, not day-precise.
* The strength meter is a V2 coincident heuristic, not a probability and not a
  forecast. It uses a 21d/126d Fed Funds panic-cut signal, a 10y-2y level plus
  21d/126d un-inversion signal, and a UNRATE Sahm-rule proxy. Weights are fixed
  and unvalidated.
* ``USREC`` is deliberately excluded from every strength input. Using the label
  to build the score would leak the target into the feature.
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

STRENGTH_VERSION = "v2-zero-lag"
STRENGTH_WEIGHTS: dict[str, float] = {
    "fed_score": 0.30,
    "curve_score": 0.30,
    "labor_score": 0.40,
}
CORE_INDEX_VERSION = "core-index-v1"
CORE_INDEX_WEIGHTS: dict[str, float] = {
    "macro": 0.40,
    "volatility": 0.30,
    "momentum": 0.30,
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


def _phase_features_for_asset(
    frame: pd.DataFrame,
    value_column: str,
    source_column: str,
    prefix: str,
) -> pd.DataFrame:
    """Realised volatility, drawdown and percentile for one target series."""
    index = frame.index
    names = {
        "volatility": f"{prefix}volatility_1y",
        "drawdown": f"{prefix}drawdown_1y",
        "percentile": f"{prefix}1y_volatility_percentile",
    }
    empty = pd.DataFrame(
        {
            names["volatility"]: np.nan,
            names["drawdown"]: np.nan,
            names["percentile"]: np.nan,
        },
        index=index,
    )
    if value_column not in frame.columns:
        return empty

    proxy = pd.to_numeric(frame[value_column], errors="coerce")
    if not proxy.notna().any():
        return empty

    source = frame.get(source_column)
    if source is not None:
        source = source.astype("string")
        groups = (
            source.ne(source.shift())
            .fillna(True)
            .astype("int64")
            .cumsum()
        )
    else:
        groups = pd.Series(1, index=index, dtype="int64")

    returns = proxy.pct_change()
    if source is not None:
        returns = returns.where(source.eq(source.shift()))
    # Drop impossible daily moves rather than letting a bad splice dominate.
    returns = returns.where(returns.abs() < 1.0)

    volatility = (
        returns.groupby(groups).transform(
            lambda series: series.rolling(252, min_periods=126).std()
        )
        * np.sqrt(252)
        * 100.0
    )
    one_year_high = proxy.groupby(groups).transform(
        lambda series: series.rolling(252, min_periods=126).max()
    )
    drawdown = (proxy / one_year_high - 1.0) * 100.0
    percentile = (
        volatility.groupby(groups).transform(
            lambda series: series.rolling(1260, min_periods=252).rank(
                pct=True
            )
        )
        * 100.0
    )

    return pd.DataFrame(
        {
            names["volatility"]: volatility,
            names["drawdown"]: drawdown,
            names["percentile"]: percentile,
        },
        index=index,
    )


def _market_phase_features(frame: pd.DataFrame) -> pd.DataFrame:
    """Realised volatility, drawdown and percentile for every asset target.

    The S&P columns keep their historical names used by the Phase Plane and the
    V2 timeline. Gold, bond and dollar targets are prefixed so the UI can switch
    the primary pane without changing the regime score. Returns are masked at
    source boundaries so a splice cannot create a fake return.
    """
    out = _phase_features_for_asset(
        frame,
        "sp500_proxy",
        "sp500_proxy_source",
        "",
    )
    for value_column, source_column, prefix in (
        ("gold_proxy", "gold_proxy_source", "gold_"),
        ("bond_proxy", "bond_proxy_source", "bond_"),
        ("btc_proxy", "btc_proxy_source", "btc_"),
        ("nifty_proxy", "nifty_proxy_source", "nifty_"),
        ("dxy_proxy", "dxy_proxy_source", "dxy_"),
    ):
        if value_column in frame.columns:
            out = out.join(
                _phase_features_for_asset(
                    frame,
                    value_column,
                    source_column,
                    prefix,
                )
            )
    return out


def calculate_macro_strength_components(frame: pd.DataFrame) -> pd.DataFrame:
    """Return the V2 strength score plus auditable, persisted components.

    Fed component (30%): a 21-day vs 126-day moving-average crossover. A slow
    easing cycle scores high, but a violent 21-day collapse in the fast average
    is treated as a panic cut and scores near zero. The panic signal looks back
    over a quarter so a single emergency cut is not forgotten immediately.

    Curve component (30%): 50% level score (a -2% curve scores 0, +2% scores
    100) and 50% 21-day vs 126-day momentum. Positive steepening is normally
    constructive, but rapid un-inversion from a negative base is penalised as a
    classic late-cycle crash signal.

    Labor component (40%): a Sahm-rule proxy. The 63-day average UNRATE is
    compared with its own 252-day rolling minimum. A 0.5 percentage-point rise
    is an immediate recession alert. The alert caps the composite at 10 so a
    labour-confirmed recession cannot print as Favorable.

    The composite is a weighted average of whichever components are available;
    ``macro_strength_coverage`` reports how much of the weight is populated.
    Older history without UNRATE is renormalised over Fed + curve rather than
    being forced to a false zero. ``sahm_alert`` is serialized for audit.

    Persisted outputs include the categorical ``regime_state`` and the market
    phase features ``volatility_1y``, ``drawdown_1y`` and
    ``1y_volatility_percentile`` used by the Phase Plane. ``fed_cross`` and
    ``curve_cross`` are the core ML features. NBER identifiers come from
    ``annotate_nber`` on the surrounding frame.
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

    labor = _first_present(frame, ("UNRATE",))
    if labor is None:
        labor = _nan_series(frame.index, "UNRATE")

    # Fed Funds: 1-month vs 6-month trend, with a quarter-long panic-cut memory.
    out["fed_fast_ma"] = fed.rolling(21, min_periods=21).mean()
    out["fed_slow_ma"] = fed.rolling(126, min_periods=126).mean()
    out["fed_cross"] = out["fed_fast_ma"] - out["fed_slow_ma"]
    out["fed_roc_21d"] = out["fed_fast_ma"].diff(21)
    out["fed_panic_drop"] = (
        -out["fed_roc_21d"]
    ).clip(lower=0.0).rolling(63, min_periods=21).max()

    # Slow easing remains constructive: fast below slow scores high.
    out["fed_easing_score"] = 100.0 - _scale(out["fed_cross"], -1.0, 1.0)
    # A violent drop is a panic cut, not a bullish easing cycle.
    out["fed_panic_score"] = 100.0 - _scale(
        out["fed_panic_drop"], 0.25, 0.75
    )
    out["fed_panic_score"] = out["fed_panic_score"].where(
        out["fed_cross"].lt(0.0), 100.0
    )
    out["fed_score"] = np.minimum(
        out["fed_easing_score"], out["fed_panic_score"]
    )

    # Yield curve: 15% level + 15% 21d/126d un-inversion momentum.
    out["curve_fast_ma"] = curve.rolling(21, min_periods=21).mean()
    out["curve_slow_ma"] = curve.rolling(126, min_periods=126).mean()
    out["curve_cross"] = out["curve_fast_ma"] - out["curve_slow_ma"]
    out["curve_level_score"] = _scale(curve, -2.0, 2.0)
    out["curve_normal_momentum"] = _scale(
        out["curve_cross"], -0.5, 0.5
    )
    # If the curve was inverted in the past year, a rapid positive move is a
    # late-cycle un-inversion warning rather than a healthy steepener.
    curve_was_inverted = (
        curve.rolling(252, min_periods=126).min().lt(0.0)
    )
    out["curve_uninversion_pressure"] = _scale(
        out["curve_cross"].clip(lower=0.0), 0.05, 0.5
    ).fillna(0.0)
    out["curve_uninversion_pressure"] = out[
        "curve_uninversion_pressure"
    ].where(curve_was_inverted, 0.0)
    out["curve_cross_score"] = np.minimum(
        out["curve_normal_momentum"],
        100.0 - out["curve_uninversion_pressure"],
    )
    out["curve_score"] = (
        0.50 * out["curve_level_score"]
        + 0.50 * out["curve_cross_score"]
    )

    inverted = pd.Series(pd.NA, index=frame.index, dtype="boolean")
    valid_curve = curve.notna()
    inverted.loc[valid_curve] = curve.loc[valid_curve].lt(0.0)
    out["curve_inverted"] = inverted

    # Labour: 3-month average vs its prior 12-month minimum (Sahm proxy).
    out["labor_fast_ma"] = labor.rolling(63, min_periods=63).mean()
    out["labor_min_12m"] = out["labor_fast_ma"].rolling(
        252, min_periods=252
    ).min()
    out["labor_gap"] = out["labor_fast_ma"] - out["labor_min_12m"]
    out["labor_score"] = 100.0 - _scale(
        out["labor_gap"], 0.0, 0.5
    )
    out["sahm_alert"] = out["labor_gap"].ge(0.5) & out[
        "labor_gap"
    ].notna()

    score_columns = list(STRENGTH_WEIGHTS)
    weights = pd.Series(STRENGTH_WEIGHTS, dtype="float64")
    available = out[score_columns].notna()
    weighted = out[score_columns].fillna(0.0).mul(weights, axis=1).sum(axis=1)
    coverage = available.mul(weights, axis=1).sum(axis=1)

    raw_strength = weighted.div(coverage.replace(0.0, np.nan))
    # A Sahm alert is an immediate recession flag. Cap the composite so the
    # 40% labour signal can actually force a Disruptive reading even while the
    # Fed/curve components are bouncing.
    out["macro_strength"] = raw_strength.where(
        ~out["sahm_alert"],
        np.fmin(raw_strength, 10.0),
    )
    out["macro_strength_coverage"] = coverage.clip(0.0, 1.0)

    label = pd.Series(pd.NA, index=frame.index, dtype="string")
    score = out["macro_strength"]
    label.loc[score.ge(60.0)] = "bullish"
    label.loc[score.le(40.0)] = "bearish"
    label.loc[score.gt(40.0) & score.lt(60.0)] = "neutral"
    out["macro_strength_label"] = label

    # Canonical persisted state vocabulary. The API and the 3x3 transition
    # matrix consume these lowercase values directly.
    regime_state = pd.Series(pd.NA, index=frame.index, dtype="string")
    regime_state.loc[score.ge(60.0)] = "favorable"
    regime_state.loc[score.le(40.0)] = "disruptive"
    regime_state.loc[score.gt(40.0) & score.lt(60.0)] = "neutral"
    out["regime_state"] = regime_state

    out = out.join(_market_phase_features(frame))
    return out


def calculate_macro_strength(frame: pd.DataFrame) -> pd.Series:
    """Return the V2 0-100 composite coincident macro-strength meter."""
    return calculate_macro_strength_components(frame)["macro_strength"].rename(
        "macro_strength"
    )


def _continuous_proxy(frame: pd.DataFrame) -> pd.Series:
    """Chain S&P source segments into a continuous price index for indicators."""
    proxy = pd.to_numeric(frame.get("sp500_proxy"), errors="coerce")
    if proxy is None or not proxy.notna().any():
        return _nan_series(frame.index, "sp500_proxy")
    source = frame.get("sp500_proxy_source")
    returns = proxy.pct_change()
    if source is not None:
        source = source.astype("string")
        returns = returns.where(source.eq(source.shift()))
    returns = returns.where(returns.abs() < 1.0).fillna(0.0)
    adjusted = (1.0 + returns).cumprod()
    adjusted = adjusted.where(proxy.notna())
    return adjusted.rename("sp500_continuous")


def _core_index_bucket(score: pd.Series) -> pd.Series:
    bucket = pd.Series(pd.NA, index=score.index, dtype="string")
    bucket.loc[score.ge(25.0)] = "strong_bullish"
    bucket.loc[score.ge(0.0) & score.lt(25.0)] = "calm_bullish"
    bucket.loc[score.lt(0.0) & score.gt(-25.0)] = "bearish_warning"
    bucket.loc[score.le(-25.0)] = "extreme_bearish"
    return bucket


def calculate_core_index(frame: pd.DataFrame) -> pd.DataFrame:
    """Compute the StrikeHike Core Index macro/volatility/momentum composite.

    Macro (40%): high-yield credit spread (40% inside macro), Fed panic/easing
    component (30%) and curve level/momentum component (30%). Volatility (30%):
    14d ATR and 20d Bollinger band width, both inverted so calm tape is
    constructive. Momentum (30%): MACD (12/26/9) and 14d RSI.

    ``core_index`` is the final 0-100 composite transformed to -50..+50.
    Zero is the neutral baseline. The credit series starts at the end of
    1996, so the composite intentionally begins there rather than manufacturing
    a pre-credit score.
    """
    out = pd.DataFrame(index=frame.index)
    proxy = _continuous_proxy(frame)
    credit = _first_present(frame, ("BAMLH0A0HYM2",))
    if credit is None:
        credit = _nan_series(frame.index, "BAMLH0A0HYM2")
    else:
        credit = pd.to_numeric(credit, errors="coerce")

    # Price-derived indicators on a source-chained proxy.
    atr = proxy.diff().abs().rolling(14, min_periods=14).mean()
    atr_pct = (atr / proxy.replace(0.0, np.nan)) * 100.0
    middle = proxy.rolling(20, min_periods=20).mean()
    deviation = proxy.rolling(20, min_periods=20).std()
    upper = middle + 2.0 * deviation
    lower = middle - 2.0 * deviation
    bollinger_width = (
        (upper - lower) / middle.replace(0.0, np.nan)
    ) * 100.0

    ema12 = proxy.ewm(span=12, adjust=False, min_periods=12).mean()
    ema26 = proxy.ewm(span=26, adjust=False, min_periods=26).mean()
    macd = ema12 - ema26
    macd_signal = macd.ewm(span=9, adjust=False, min_periods=9).mean()
    macd_hist = macd - macd_signal
    macd_pct = (macd / proxy.replace(0.0, np.nan)) * 100.0

    delta = proxy.diff()
    gains = delta.clip(lower=0.0)
    losses = (-delta).clip(lower=0.0)
    avg_gain = gains.rolling(14, min_periods=14).mean()
    avg_loss = losses.rolling(14, min_periods=14).mean()
    relative_strength = avg_gain / avg_loss.replace(0.0, np.nan)
    rsi = 100.0 - (100.0 / (1.0 + relative_strength))
    rsi = rsi.mask(avg_loss.eq(0.0) & avg_gain.gt(0.0), 100.0)
    rsi = rsi.mask(avg_loss.eq(0.0) & avg_gain.eq(0.0), 50.0)

    out["hy_oas"] = credit
    out["credit_score"] = 100.0 - _scale(credit, 3.0, 10.0)
    out["atr_14"] = atr
    out["atr_pct"] = atr_pct
    out["bollinger_width"] = bollinger_width
    out["macd"] = macd
    out["macd_signal"] = macd_signal
    out["macd_hist"] = macd_hist
    out["rsi_14"] = rsi

    fed_score = frame.get("fed_score")
    curve_score = frame.get("curve_score")
    if fed_score is None:
        fed_score = _nan_series(frame.index, "fed_score")
    if curve_score is None:
        curve_score = _nan_series(frame.index, "curve_score")

    credit_component = out["credit_score"]
    macro_score = (
        0.40 * credit_component
        + 0.30 * fed_score
        + 0.30 * curve_score
    ).where(
        credit_component.notna()
        & fed_score.notna()
        & curve_score.notna()
    )
    out["macro_score"] = macro_score

    atr_score = 100.0 - _scale(out["atr_pct"], 0.5, 4.0)
    bollinger_score = 100.0 - _scale(out["bollinger_width"], 2.0, 20.0)
    out["atr_score"] = atr_score
    out["bollinger_score"] = bollinger_score
    volatility_score = 0.50 * atr_score + 0.50 * bollinger_score
    out["core_volatility_score"] = volatility_score

    macd_score = _scale(macd_pct, -1.0, 1.0)
    rsi_score = _scale(rsi, 30.0, 70.0)
    out["macd_score"] = macd_score
    out["rsi_score"] = rsi_score
    momentum_score = 0.50 * macd_score + 0.50 * rsi_score
    out["core_momentum_score"] = momentum_score

    composite = (
        CORE_INDEX_WEIGHTS["macro"] * macro_score
        + CORE_INDEX_WEIGHTS["volatility"] * volatility_score
        + CORE_INDEX_WEIGHTS["momentum"] * momentum_score
    )
    composite = composite.where(
        macro_score.notna()
        & volatility_score.notna()
        & momentum_score.notna()
    )
    out["core_index_composite"] = composite
    score = composite - 50.0
    out["core_index"] = score
    out["core_index_bucket"] = _core_index_bucket(score)
    return out


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
    # A frame that begins inside a recession has no prior observation to diff
    # against. Treat the first valid recession row as an episode start so the
    # first NBER run is identified as 1 rather than 0 (which means expansion).
    first_valid = recession.first_valid_index()
    if first_valid is not None and recession.loc[first_valid] == 1:
        change.loc[first_valid] = 1

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
        "core_index": None,
        "core_index_bucket": None,
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
        "core_index": _as_float(row.get("core_index"), 2),
        "core_index_bucket": _as_str(row.get("core_index_bucket")),
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
    only to its own last observation, so source boundaries stay honest. A
    modern source whose last print is within a month of the frame end carries
    that print over the stale tail, preventing a lower-priority series from
    creating a fake splice in the final days.

    Levels are not chained across sources and gaps are preserved. The source
    column tells the frontend which segment it is drawing.
    """
    proxy = pd.Series(np.nan, index=frame.index, name="sp500_proxy", dtype="float64")
    source = pd.Series(pd.NA, index=frame.index, name="sp500_proxy_source", dtype="string")
    source_frame = raw_frame if raw_frame is not None else frame
    frame_end = frame.index.max()

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
        # A modern source current to within a month should carry its last print
        # over a stale weekend/holiday tail. Without this, a lower-priority
        # series can jump in and create a fake splice at the end of the tape.
        filled = (
            raw.ffill()
            if (
                last_valid >= frame_end - pd.Timedelta(days=30)
                and int(raw.notna().sum()) >= 5
            )
            else raw.ffill().loc[:last_valid]
        )
        mask = proxy.isna() & filled.notna()
        proxy.loc[mask] = filled.loc[mask]
        source.loc[mask] = column

    return pd.DataFrame(
        {"sp500_proxy": proxy, "sp500_proxy_source": source},
        index=frame.index,
    )
