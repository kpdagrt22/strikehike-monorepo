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
* Core Index v2 is a weekly trend-and-stress state machine decided at each
  Friday close. ``calculate_core_index_v2`` applies every input's publication
  lag itself and never reads ``USREC`` or a pipeline-derived column. The v1
  macro/volatility/momentum blend survives as ``calculate_core_index_v1`` for
  audits and for the legacy diagnostic columns.
* The trend warning (``core_index_trend_warning``) is a separate, more
  sensitive flag beside the Core Index: the same Friday S&P close below the
  average of the last 40 Friday closes. It changes nothing in the Core Index.
* The fast warning (``core_index_fast_warning``) is a separate daily flag:
  the S&P close 7% or more below the close 14 days earlier. It reacts to a
  sharp fall, is not a forecast, and changes nothing in the Core Index.
"""

from __future__ import annotations

import copy
from typing import Any

import numpy as np
import pandas as pd

STRENGTH_VERSION = "v2-zero-lag"
STRENGTH_WEIGHTS: dict[str, float] = {
    "fed_score": 0.30,
    "curve_score": 0.30,
    "labor_score": 0.40,
}
CORE_INDEX_VERSION = "core-index-v2"
# v2 is a state machine, not a weighted blend. The name stays because the
# ingestion metadata imports it.
CORE_INDEX_WEIGHTS: dict[str, float] = {}
# Core Index v1 (macro/volatility/momentum blend), kept for audits and for the
# legacy diagnostic columns it still writes.
CORE_INDEX_V1_WEIGHTS: dict[str, float] = {
    "macro": 0.40,
    "volatility": 0.30,
    "momentum": 0.30,
}

# Core Index v2 publication lags (months, days): a value stamped s is known on
# day d when s + lag <= d. The equity close is known the same day.
CORE_INDEX_INPUT_LAGS: dict[str, tuple[int, int]] = {
    "BAMLH0A0HYM2": (0, 1),  # ICE BofA HY OAS, daily
    "BAA10Y": (0, 1),  # Moody's Baa minus 10y Treasury, daily
    "DGS10": (0, 1),  # 10y Treasury, daily
    "DFF": (0, 1),  # effective Fed Funds, daily
    "BAA": (1, 1),  # Moody's Baa monthly average, complete at month end
    "AAA": (1, 1),  # Moody's Aaa monthly average
    "GS10": (1, 1),  # 10y Treasury monthly average
    "TB3MS": (1, 1),  # 3-month bill monthly average
    "UNRATE": (1, 10),  # Employment Situation, about 10 days after month end
}
# sp500_proxy_source labels of daily-close segments. v2 reads the chained
# equity proxy only on these; the monthly Cowles segment is never used.
CORE_INDEX_DAILY_EQUITY_SOURCES: tuple[str, ...] = (
    "YAHOO_FINANCE_GSPC",  # analytics.SP500_DAILY_SOURCE, ^GSPC from 1927-12-30
    "SP500",  # FRED S&P 500
    "NASDAQCOM",  # older artifacts' proxy segment
)
CORE_INDEX_PARAMS: dict[str, float] = {
    "ma_long": 40,  # weeks: long trend average (about 200 trading days)
    "slope_weeks": 4,  # slope of the long average over 4 weeks
    "ma_short": 10,  # weeks: warm-up readiness only
    "high_weeks": 52,  # 52-week high
    "vol_short": 13,  # weeks of weekly log returns
    "vol_long": 52,
    "dd_fast": 0.10,  # stress break: 10% below the 52-week high ...
    "vol_expand": 1.5,  # ... with 13-week vol >= 1.5 x 52-week vol
    "ext_in": 1.0,  # Trim at log(price / 40w avg) >= 1.0 x 52-week vol
    "ext_out": 0.5,  # leave Trim below 0.5
    "cap_dd": 0.20,  # capitulation: 20% below the 52-week high ...
    "cap_vol": 1.5,  # ... with 13-week vol >= 1.5 x 52-week vol
    "stab_vol": 0.75,  # stabilised: 13-week vol <= 75% of the spell peak
    "ma_stab": 40,  # ... and price above its 40-week average
    "acc_exit_dd": 0.10,  # leave Accumulate within 10% of the 52-week high
    "flag_dd": 0.05,  # early flag: 5% below the 52-week high ...
    "flag_stress": 2,  # ... while >= 2 macro stress flags are on
    "bear_stress": 2,  # severity bear at >= 2 stress flags (or a 20% fall)
    "crash_stress": 3,  # crash at >= 3 flags with a crash_fall fall (or 35%)
    "crash_fall": 0.20,
    "credit_widen": 0.30,  # stress: a credit spread >= 30% above its 52w low
    "sahm": 0.50,  # stress: Sahm gap >= 0.5 pp while unemployment rises
    "inversion_weeks": 52,  # stress: curve inverted within the last 52 weeks
    "vol_crash": 1.5,  # stress: 13-week vol >= 1.5 x 52-week vol
    "smooth_span": 6,  # score filter span (weeks)
}
CORE_INDEX_SEVERITIES: tuple[str, ...] = ("none", "correction", "bear", "crash")
CORE_INDEX_V2_COLUMNS: tuple[str, ...] = (
    "core_index",
    "core_index_composite",
    "core_index_bucket",
    "core_index_severity",
    "core_index_warning",
    "core_index_trend_warning",
    "core_index_fast_warning",
)
# Trend warning: a separate, more sensitive early-warning flag shown beside
# the calm Core Index. It is the standard 40-week moving-average rule (the
# evaluation harness's reference rule), not fitted to any period, and it
# changes nothing in the Core Index state, score, bucket, severity or warning.
CORE_INDEX_TREND_VERSION = "trend-warning-40w-v1"
CORE_INDEX_TREND_WEEKS = 40
CORE_INDEX_TREND_RULE = (
    "on when the Friday close of the daily S&P 500 is below the simple average "
    "of the last 40 Friday closes (this Friday included); held until the next "
    "Friday"
)
# Measured once with the evaluation harness on the artifact named in
# ``measured_on``: causal weekly data, nothing fitted. Misses and false alarms
# are part of the record. Historical, not a forecast. Shares are fractions.
_CORE_INDEX_TREND_FALL_FIELDS: tuple[str, ...] = (
    "name",
    "peak",
    "low",
    "size",
    "first_warning",
    "warning_on_since",
    "down_then",
    "within_first_20pct",
    "left_on_from_the_decline_before",
    "warnings_before_20pct_mark",
)
# Every S&P 500 fall of 20% or more since 1929, in the order of the fields.
_CORE_INDEX_TREND_FALLS: tuple[tuple[Any, ...], ...] = (
    ("1929 crash / Great Depression", "1929-09-16", "1932-06-01", 0.86,
     "1929-10-25", "1929-10-25", 0.18, False, False, 0),
    ("1932-33 relapse", "1932-09-07", "1933-02-27", 0.41,
     "1932-07-15", "1930-05-02", 0.0, True, True, 1),
    ("1933-35 bear", "1933-07-18", "1935-03-14", 0.34,
     "1934-05-04", "1934-05-04", 0.15, False, False, 0),
    ("1937-42 bear", "1937-03-10", "1942-04-28", 0.6,
     "1937-04-23", "1937-04-23", 0.1, True, False, 1),
    ("1946-49 post-war bear", "1946-05-29", "1949-06-13", 0.3,
     "1946-07-26", "1946-07-26", 0.09, False, False, 0),
    ("1956-57 bear", "1956-08-02", "1957-10-22", 0.21,
     "1956-05-25", "1956-05-25", 0.0, True, False, 2),
    ("1962 Kennedy slide", "1961-12-12", "1962-06-26", 0.28,
     "1962-04-06", "1962-04-06", 0.05, False, False, 0),
    ("1966 credit crunch", "1966-02-09", "1966-10-07", 0.22,
     "1966-03-04", "1966-03-04", 0.05, False, False, 0),
    ("1968-70 bear", "1968-11-29", "1970-05-26", 0.36,
     "1969-01-10", "1969-01-10", 0.07, True, False, 1),
    ("1973-74 oil shock", "1973-01-11", "1974-10-03", 0.48,
     "1972-10-13", "1972-10-13", 0.0, True, False, 3),
    ("1980-82 Volcker bear", "1980-11-28", "1982-08-12", 0.27,
     "1981-05-22", "1981-05-22", 0.07, False, False, 0),
    ("1987 crash", "1987-08-25", "1987-12-04", 0.34,
     "1987-10-16", "1987-10-16", 0.16, False, False, 0),
    ("2000-02 dot-com", "2000-03-24", "2002-10-09", 0.49,
     "1999-10-22", "1999-10-15", 0.0, True, False, 3),
    ("2007-09 GFC", "2007-10-09", "2009-03-09", 0.57,
     "2007-08-03", "2007-08-03", 0.0, True, False, 4),
    ("2020 COVID", "2020-02-19", "2020-03-23", 0.34,
     "2020-02-28", "2020-02-28", 0.13, False, False, 0),
    ("2022 inflation bear", "2022-01-03", "2022-10-12", 0.25,
     "2022-01-21", "2022-01-21", 0.08, False, False, 0),
)
_CORE_INDEX_TREND_PERIODS: tuple[str, ...] = ("1928-1971", "1971-1989", "1990-2026", "all")
CORE_INDEX_TREND_RECORD: dict[str, Any] = {
    "measured_on": {
        "data_version": "8c3b382a9b5b",
        "first_week": "1928-09-28",
        "last_week": "2026-10-23",
        "harness": "cih-1.1-gspc",
        "measured": "2026-10-28",
    },
    "falls_of_20pct_or_more": {
        "count": 16,
        "on_within_first_20pct": 7,
        "fresh_warning_within_first_20pct": 6,
        "left_on_from_the_decline_before": 1,
        "not_within_first_20pct": 9,
        "two_or_more_warnings_before_20pct_mark": 4,
        "falls": [
            dict(zip(_CORE_INDEX_TREND_FALL_FIELDS, fall))
            for fall in _CORE_INDEX_TREND_FALLS
        ],
    },
    "false_alarms_per_decade": dict(zip(_CORE_INDEX_TREND_PERIODS, (1.7, 2.6, 7.6, 4.1))),
    "share_of_weeks_on": dict(zip(_CORE_INDEX_TREND_PERIODS, (0.37, 0.34, 0.25, 0.32))),
    # The combined view: the Core Index warning OR the trend warning.
    "with_core_index_warning": {
        "on_within_first_20pct": 8,
        "fresh_warning_within_first_20pct": 6,
        "left_on_from_the_decline_before": 2,
        "not_within_first_20pct": 8,
        "two_or_more_warnings_before_20pct_mark": 4,
        "false_alarms_per_decade": dict(
            zip(_CORE_INDEX_TREND_PERIODS, (1.2, 4.2, 7.1, 4.0))
        ),
        "share_of_weeks_on": dict(zip(_CORE_INDEX_TREND_PERIODS, (0.44, 0.46, 0.31, 0.4))),
    },
    "definitions": {
        "fall": (
            "the daily S&P 500 close 20% or more below a running peak; a new "
            "fall inside a long recovery counts separately"
        ),
        "within_first_20pct": (
            "on before the first Friday whose close has done 20% of the eventual "
            "fall (a warning still on from the decline before counts)"
        ),
        "false_alarm": (
            "a warning that starts outside every window from 26 weeks before a "
            "10%+ fall's peak to its low"
        ),
    },
}
# Fast warning: a separate daily flag beside the Core Index and the trend
# warning. It reacts to a sharp fall of the S&P 500; it is not a forecast.
# Pre-registered as "10-session return <= -7%", chosen after its record on this
# same history was seen, and computed on calendar days because the artifact does
# not carry the session calendar (14 calendar days = 10 sessions unless a holiday
# falls inside). It changes nothing in the Core Index or the trend warning.
CORE_INDEX_FAST_VERSION = "fast-warning-14d-7pct-v1"
CORE_INDEX_FAST_DAYS = 14
CORE_INDEX_FAST_DROP = 0.07
CORE_INDEX_FAST_RULE = (
    "on when the daily S&P 500 close is 7% or more below the close 14 calendar "
    "days earlier; decided at each close; a reaction to a sharp fall, not a "
    "forecast"
)
# Measured from the stored column of the artifact named in ``measured_on``
# with the judge's evaluator (the harness's fall definitions on the raw ^GSPC
# sessions), and generated from its output, not typed. Hits, misses and false
# alarms are all part of the record; historical, not a forecast. Shares are
# fractions; the eras are the trend record's. Re-measure after any
# re-ingestion that changes prices.
_CORE_INDEX_FAST_FALL_FIELDS: tuple[str, ...] = (
    "name",
    "peak",
    "low",
    "size",
    "first_warning",
    "warning_during_fall",
    "down_then",
    "within_first_20pct",
    "during_the_fall",
    "before_the_peak_only",
    "first_after_peak",
    "down_at_first_after_peak",
)
# Every S&P 500 fall of 20% or more since 1929, in the order of the fields.
_CORE_INDEX_FAST_FALLS: tuple[tuple[Any, ...], ...] = (
    ("1929 crash / Great Depression", "1929-09-16", "1932-06-01", 0.86,
     "1929-10-03", "1929-10-03", 0.09, True, True, False, "1929-10-03", 0.09),
    ("1932-33 relapse", "1932-09-07", "1933-02-27", 0.41,
     "1932-09-13", None, 0.16, False, False, False, "1932-09-13", 0.16),
    ("1933-35 bear", "1933-07-18", "1935-03-14", 0.34,
     "1933-07-20", None, 0.13, False, False, False, "1933-07-20", 0.13),
    ("1937-42 bear", "1937-03-10", "1942-04-28", 0.6,
     "1937-03-22", "1937-03-22", 0.08, True, True, False, "1937-03-22", 0.08),
    ("1946-49 post-war bear", "1946-05-29", "1949-06-13", 0.3,
     "1946-03-04", None, 0.0, True, False, True, "1946-08-27", 0.12),
    ("1956-57 bear", "1956-08-02", "1957-10-22", 0.21,
     "1957-10-21", None, 0.21, False, False, False, "1957-10-21", 0.21),
    ("1962 Kennedy slide", "1961-12-12", "1962-06-26", 0.28,
     "1962-05-28", None, 0.24, False, False, False, "1962-05-28", 0.24),
    ("1966 credit crunch", "1966-02-09", "1966-10-07", 0.22,
     "1966-05-16", None, 0.1, False, False, False, "1966-05-16", 0.1),
    ("1968-70 bear", "1968-11-29", "1970-05-26", 0.36,
     "1970-04-27", None, 0.25, False, False, False, "1970-04-27", 0.25),
    ("1973-74 oil shock", "1973-01-11", "1974-10-03", 0.48,
     "1973-05-21", None, 0.15, False, False, False, "1973-05-21", 0.15),
    ("1980-82 Volcker bear", "1980-11-28", "1982-08-12", 0.27,
     "1980-12-10", None, 0.09, False, False, False, "1980-12-10", 0.09),
    ("1987 crash", "1987-08-25", "1987-12-04", 0.34,
     "1987-10-15", None, 0.11, False, False, False, "1987-10-15", 0.11),
    ("2000-02 dot-com", "2000-03-24", "2002-10-09", 0.49,
     "2000-01-28", None, 0.0, True, False, True, "2000-04-14", 0.11),
    ("2007-09 GFC", "2007-10-09", "2009-03-09", 0.57,
     "2008-01-08", "2008-01-08", 0.11, True, True, False, "2008-01-08", 0.11),
    ("2020 COVID", "2020-02-19", "2020-03-23", 0.34,
     "2020-02-26", None, 0.08, False, False, False, "2020-02-26", 0.08),
    ("2022 inflation bear", "2022-01-03", "2022-10-12", 0.25,
     "2022-01-25", None, 0.09, False, False, False, "2022-01-25", 0.09),
)
CORE_INDEX_FAST_RECORD: dict[str, Any] = {
    "measured_on": {
        "data_version": "59192d5aa731",
        "first_day": "1928-01-13",
        "last_day": "2026-10-27",
        "harness": "cih-1.1-gspc (definitions, daily sessions)",
        "evaluator": "fast-warning/judge/scripts/measure_fast_record.py",
        "measured": "2026-10-28",
    },
    "falls_of_20pct_or_more": {
        "count": 16,
        "within_first_20pct": 5,
        "during_the_fall": 3,
        "before_the_peak_only": 2,
        "left_on_from_the_decline_before": 0,
        "not_within_first_20pct": 11,
        "falls": [
            dict(zip(_CORE_INDEX_FAST_FALL_FIELDS, fall))
            for fall in _CORE_INDEX_FAST_FALLS
        ],
    },
    "false_alarms": dict(zip(_CORE_INDEX_TREND_PERIODS, (1, 4, 2, 7))),
    "false_alarms_per_decade": dict(
        zip(_CORE_INDEX_TREND_PERIODS, (0.2, 2.1, 0.5, 0.7))
    ),
    "share_of_days_on": dict(
        zip(_CORE_INDEX_TREND_PERIODS, (0.039, 0.014, 0.018, 0.027))
    ),
    "spells_per_year": dict(zip(_CORE_INDEX_TREND_PERIODS, (2.8, 1.3, 1.6, 2.1))),
    # The combined view: the trend warning OR the fast warning.
    "with_trend_warning": {
        "within_first_20pct": 10,
        "during_the_fall": 5,
        "trend_warning_alone_during_the_fall": 4,
        "newly_during_the_fall": ["1929 crash / Great Depression"],
        "false_alarms_per_decade": dict(
            zip(_CORE_INDEX_TREND_PERIODS, (1.9, 3.7, 7.6, 4.4))
        ),
        "extra_false_alarms_vs_trend_alone": dict(
            zip(_CORE_INDEX_TREND_PERIODS, (1, 2, 0, 3))
        ),
    },
    "definitions": {
        "fall": (
            "the daily S&P 500 close 20% or more below a running peak; a new fall "
            "inside a long recovery counts separately"
        ),
        "within_first_20pct": (
            "on at a close before the first close that has done 20% of the eventual "
            "fall, counting from 26 weeks before the peak"
        ),
        "during_the_fall": (
            "on at a close from the peak to the session before that 20% mark"
        ),
        "false_alarm": (
            "a warning that starts outside every window from 26 weeks before a 10%+ "
            "fall's peak to its low"
        ),
    },
}
# The 16 v1 diagnostic columns still written (values unchanged, not v2 inputs).
CORE_INDEX_V1_LEGACY_COLUMNS: tuple[str, ...] = (
    "hy_oas",
    "credit_score",
    "atr_14",
    "atr_pct",
    "bollinger_width",
    "macd",
    "macd_signal",
    "macd_hist",
    "rsi_14",
    "macro_score",
    "atr_score",
    "bollinger_score",
    "core_volatility_score",
    "macd_score",
    "rsi_score",
    "core_momentum_score",
)
CORE_INDEX_BUCKET_RANGES: dict[str, str] = {
    "strong_bullish": ">= 25",
    "calm_bullish": "0 to 24",
    "bearish_warning": "-1 to -24",
    "extreme_bearish": "<= -25",
}
CORE_INDEX_METHOD = (
    "weekly trend-and-stress state machine (Friday close), held until the next "
    "Friday"
)
CORE_INDEX_FEATURES: tuple[str, ...] = (
    "sp500_proxy (chained, daily sources only)",
    "BAMLH0A0HYM2",
    "BAA10Y",
    "BAA-AAA",
    "UNRATE",
    "DGS10-DFF (GS10-TB3MS before 1962)",
)
CORE_INDEX_V1_NOTE_PREFIX = "Core Index is a descriptive 40/30/30"
CORE_INDEX_NOTE = (
    "Core Index v2 is a weekly trend-and-stress state machine on the daily S&P "
    "500 (the S&P 90 before March 1957), with credit spreads, unemployment and "
    "the yield curve as stress inputs, each lagged by its publication delay. It "
    "is decided at each Friday close and held until the next; it starts at the "
    "end of 1928, once a year of daily closes exists. Until 1948 only the "
    "Baa-Aaa credit spread and volatility can raise stress flags; unemployment "
    "joins in 1949 and the yield curve in 1953. The four bands keep their "
    "allocation meaning; severity describes the decline under way. Not a "
    "forecast."
)

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


def _as_bool(value: Any) -> bool | None:
    if value is None:
        return None
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass
    return bool(value)


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


def calculate_core_index_v1(frame: pd.DataFrame) -> pd.DataFrame:
    """Compute the retired Core Index v1 macro/volatility/momentum composite.

    Kept for audits and for the 16 legacy diagnostic columns
    (``CORE_INDEX_V1_LEGACY_COLUMNS``) that ``calculate_core_index`` still
    writes. Its ``core_index`` columns are replaced by v2.

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
        CORE_INDEX_V1_WEIGHTS["macro"] * macro_score
        + CORE_INDEX_V1_WEIGHTS["volatility"] * volatility_score
        + CORE_INDEX_V1_WEIGHTS["momentum"] * momentum_score
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
# Core Index v2: weekly trend-and-stress state machine
# ---------------------------------------------------------------------------

# state -> (bucket, printed score band)
_CORE_INDEX_STATES: dict[str, tuple[str, tuple[float, float]]] = {
    "TRIM": ("strong_bullish", (25.0, 50.0)),
    "NORMAL": ("calm_bullish", (0.0, 24.0)),
    "WARNING": ("bearish_warning", (-24.0, -1.0)),
    "ACCUMULATE": ("extreme_bearish", (-50.0, -25.0)),
}
_WEEKS_PER_YEAR = 52.0


def _core_index_v2_known(
    series: pd.Series,
    index: pd.DatetimeIndex,
    months: int,
    days: int,
) -> np.ndarray:
    """Forward-filled daily ``series`` as known on each date of ``index``.

    A value stamped s is known on day d when s + lag <= d, so this reads the
    forward-filled series at d - lag. Dates before the frame starts are NaN.
    """
    shifted = index
    if months:
        shifted = shifted - pd.DateOffset(months=months)
    if days:
        shifted = shifted - pd.Timedelta(days=days)
    values = pd.to_numeric(series, errors="coerce")
    return values.reindex(shifted).to_numpy(dtype=float)


def _core_index_v2_inputs(frame: pd.DataFrame) -> pd.DataFrame:
    """Friday rows of the causal v2 inputs, publication lags applied.

    Rows are the Fridays of the daily index, so a Friday holiday carries
    Thursday's close. The equity input is the source-chained proxy kept only
    on daily-close segments (``CORE_INDEX_DAILY_EQUITY_SOURCES``).
    """
    fridays = frame.index[frame.index.dayofweek == 4]
    equity = np.full(len(fridays), np.nan)
    if {"sp500_proxy", "sp500_proxy_source"}.issubset(frame.columns):
        chained = _continuous_proxy(frame)
        source = frame["sp500_proxy_source"].astype("string")
        daily = source.isin(list(CORE_INDEX_DAILY_EQUITY_SOURCES))
        equity = chained.where(daily).reindex(fridays).to_numpy(dtype=float)
    out: dict[str, np.ndarray] = {"spx": equity}
    for column, (months, days) in CORE_INDEX_INPUT_LAGS.items():
        if column in frame.columns:
            out[column] = _core_index_v2_known(frame[column], fridays, months, days)
        else:
            out[column] = np.full(len(fridays), np.nan)
    return pd.DataFrame(out, index=fridays)


def _core_index_v2_column(frame: pd.DataFrame, name: str) -> pd.Series:
    if name not in frame.columns:
        return pd.Series(np.nan, index=frame.index, dtype="float64")
    return pd.to_numeric(frame[name], errors="coerce").astype(float)


def _core_index_v2_features(inputs: pd.DataFrame) -> pd.DataFrame:
    """Weekly price, credit, labour and curve features plus the stress flags.

    Every window counts weekly rows and looks only backwards.
    """
    p = CORE_INDEX_PARAMS
    spx = _core_index_v2_column(inputs, "spx")
    returns = np.log(spx).diff()
    n_long, n_short, n_stab = int(p["ma_long"]), int(p["ma_short"]), int(p["ma_stab"])
    ma_long = spx.rolling(n_long, min_periods=n_long).mean()
    ma_short = spx.rolling(n_short, min_periods=n_short).mean()
    ma_stab = spx.rolling(n_stab, min_periods=n_stab).mean()
    slope = ma_long / ma_long.shift(int(p["slope_weeks"])) - 1.0
    n_high = int(p["high_weeks"])
    hi52 = spx.rolling(n_high, min_periods=n_high).max()
    dd52 = spx / hi52 - 1.0
    n_vs, n_vl = int(p["vol_short"]), int(p["vol_long"])
    vol13 = returns.rolling(n_vs, min_periods=n_vs).std() * np.sqrt(_WEEKS_PER_YEAR)
    vol52 = returns.rolling(n_vl, min_periods=n_vl).std() * np.sqrt(_WEEKS_PER_YEAR)
    ext = np.log(spx / ma_long) / vol52.replace(0.0, np.nan)

    spreads = {
        "hy_oas": _core_index_v2_column(inputs, "BAMLH0A0HYM2"),
        "baa_10y": _core_index_v2_column(inputs, "BAA10Y"),
        "baa_aaa": _core_index_v2_column(inputs, "BAA")
        - _core_index_v2_column(inputs, "AAA"),
    }
    widen_parts, off_peak_parts = [], []
    for name, spread in spreads.items():
        spread = spread.where(spread > 0)
        low = spread.rolling(52, min_periods=26).min()
        widen_parts.append((spread / low - 1.0).rename(name))
        peak = spread.rolling(13, min_periods=8).max()
        off_peak_parts.append((spread / peak - 1.0).rename(name))
    widen = pd.concat(widen_parts, axis=1)
    off_peak = pd.concat(off_peak_parts, axis=1)
    credit_widen = widen.max(axis=1, skipna=True)
    have_credit = widen.notna().any(axis=1)
    credit_easing = (off_peak.max(axis=1, skipna=True) < -0.0001) | ~have_credit

    unemployment = _core_index_v2_column(inputs, "UNRATE")
    u3 = unemployment.rolling(13, min_periods=13).mean()
    sahm = u3 - u3.rolling(52, min_periods=52).min()
    un_rising = u3 > u3.shift(13)

    fed_funds = _core_index_v2_column(inputs, "DFF").rolling(4, min_periods=1).mean()
    curve = _core_index_v2_column(inputs, "DGS10") - fed_funds
    curve = curve.where(
        curve.notna(),
        _core_index_v2_column(inputs, "GS10") - _core_index_v2_column(inputs, "TB3MS"),
    )
    recent_inversion = (
        curve.lt(0.0)
        .astype(float)
        .where(curve.notna())
        .rolling(int(p["inversion_weeks"]), min_periods=26)
        .max()
        .gt(0.0)
    )

    vol_ratio = vol13 / vol52
    flags = pd.DataFrame(
        {
            "flag_credit": credit_widen.ge(p["credit_widen"]),
            "flag_labour": sahm.ge(p["sahm"]) & un_rising.fillna(False).astype(bool),
            "flag_curve": recent_inversion.fillna(False).astype(bool),
            "flag_vol": vol_ratio.ge(p["vol_crash"]),
        },
        index=inputs.index,
    )
    features = pd.DataFrame(
        {
            "spx": spx,
            "ma_long": ma_long,
            "ma_short": ma_short,
            "ma_stab": ma_stab,
            "slope": slope,
            "hi52": hi52,
            "dd52": dd52,
            "vol13": vol13,
            "vol52": vol52,
            "vol_ratio": vol_ratio,
            "ext": ext,
            "credit_widen": credit_widen,
            "credit_easing": credit_easing,
            "sahm": sahm,
            "un_rising": un_rising,
            "curve": curve,
            "recent_inversion": recent_inversion,
        },
        index=inputs.index,
    )
    features = features.join(flags)
    features["stress"] = flags.sum(axis=1).astype("int64")
    return features


def _core_index_v2_state(
    features: pd.DataFrame,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Run the state machine forward, one step per Friday.

    Returns the state (``None`` where not ready), the severity and the
    warning flag as numpy arrays. States stay in numpy object arrays: pandas
    3 would store a missing state as NaN rather than None.
    """
    p = CORE_INDEX_PARAMS
    stress = features["stress"].to_numpy(dtype=float)
    spx = features["spx"].to_numpy(dtype=float)
    ma_long = features["ma_long"].to_numpy(dtype=float)
    ma_short = features["ma_short"].to_numpy(dtype=float)
    ma_stab = features["ma_stab"].to_numpy(dtype=float)
    hi52 = features["hi52"].to_numpy(dtype=float)
    slope = features["slope"].to_numpy(dtype=float)
    dd = features["dd52"].to_numpy(dtype=float)
    vol13 = features["vol13"].to_numpy(dtype=float)
    vol_ratio = features["vol_ratio"].to_numpy(dtype=float)
    ext = features["ext"].to_numpy(dtype=float)
    easing = features["credit_easing"].to_numpy(dtype=bool)

    n = len(features)
    state = np.full(n, None, dtype=object)
    severity = np.full(n, None, dtype=object)
    warning = np.zeros(n, dtype=bool)
    ready = (
        np.isfinite(spx)
        & np.isfinite(ma_long)
        & np.isfinite(slope)
        & np.isfinite(dd)
        & np.isfinite(vol_ratio)
        & np.isfinite(ext)
        & np.isfinite(ma_stab)
        & np.isfinite(ma_short)
    )

    current: str | None = None
    spell_low = spell_vol_peak = ref_high = np.nan
    capitulated = broken = pre_on = False
    sev_rank = 0
    for i in range(n):
        if not ready[i]:
            # Not ready: the next ready week starts fresh.
            current, sev_rank, pre_on = None, 0, False
            continue
        trend_break = spx[i] < ma_long[i] and slope[i] < 0.0
        stress_break = dd[i] <= -p["dd_fast"] and vol_ratio[i] >= p["vol_expand"]
        # Fix 1: the trend-repair exit needs both entry conditions to be off.
        repaired = (
            spx[i] > ma_long[i]
            and slope[i] > 0.0
            and not stress_break
            and not trend_break
        )
        previous = current
        if current is None:
            if trend_break or stress_break:
                current = "WARNING"
            elif ext[i] >= p["ext_in"]:
                current = "TRIM"
            else:
                current = "NORMAL"
        elif current in ("NORMAL", "TRIM"):
            if trend_break or stress_break:
                current = "WARNING"
            elif current == "NORMAL" and ext[i] >= p["ext_in"]:
                current = "TRIM"
            elif current == "TRIM" and ext[i] < p["ext_out"]:
                current = "NORMAL"
        elif current == "WARNING":
            spell_low = min(spell_low, spx[i])
            spell_vol_peak = np.nanmax([spell_vol_peak, vol13[i]])
            if dd[i] <= -p["cap_dd"] and vol_ratio[i] >= p["cap_vol"]:
                capitulated = True
            if trend_break:
                broken = True
            stabilised = (
                spx[i] > ma_stab[i]
                and vol13[i] <= p["stab_vol"] * spell_vol_peak
                and easing[i]
            )
            # Fix 2: Accumulate also needs a trend break during the spell.
            if capitulated and broken and stabilised:
                current = "ACCUMULATE"
            elif repaired:
                current = "NORMAL"
        elif current == "ACCUMULATE":
            if spx[i] < spell_low:  # failed bottom
                current = "WARNING"
                spell_low, capitulated, broken = spx[i], False, False
            elif dd[i] >= -p["acc_exit_dd"]:  # fear has passed
                current = "NORMAL"
        if current == "WARNING" and previous not in ("WARNING", "ACCUMULATE"):
            # A new spell.
            spell_low, spell_vol_peak = spx[i], vol13[i]
            capitulated, ref_high = False, hi52[i]
            broken = bool(trend_break)
        state[i] = current

        # Early flag: only in Balanced Growth or Trim.
        if current in ("NORMAL", "TRIM"):
            if not pre_on and dd[i] <= -p["flag_dd"] and stress[i] >= p["flag_stress"]:
                pre_on = True
            elif pre_on and (
                dd[i] > -0.5 * p["flag_dd"] or stress[i] < p["flag_stress"]
            ):
                pre_on = False
        else:
            pre_on = False
        warning[i] = current == "WARNING" or pre_on
        if warning[i]:
            ref = (
                ref_high
                if current == "WARNING" and np.isfinite(ref_high) and ref_high > 0
                else hi52[i]
            )
            fall = spx[i] / ref - 1.0
            instant = 1
            if stress[i] >= p["bear_stress"] or fall <= -0.20:
                instant = 2
            if (
                stress[i] >= p["crash_stress"] and fall <= -p["crash_fall"]
            ) or fall <= -0.35:
                instant = 3
            # Severity only ratchets up within a spell.
            sev_rank = max(sev_rank, instant)
            severity[i] = CORE_INDEX_SEVERITIES[sev_rank]
        elif current == "ACCUMULATE":
            # The class of the decline being bought.
            severity[i] = CORE_INDEX_SEVERITIES[max(sev_rank, 1)]
        else:
            sev_rank = 0
            severity[i] = "none"
    return state, severity, warning


def _core_index_v2_score(
    state: np.ndarray,
    ext: np.ndarray,
    drawdown: np.ndarray,
) -> np.ndarray:
    """Printed score: a span-6 filter towards the state's target, clamped to
    the state's band, so a state change lands on the nearest band edge."""
    p = CORE_INDEX_PARAMS
    alpha = 2.0 / (float(p["smooth_span"]) + 1.0)
    dd = np.minimum(drawdown, 0.0)
    out = np.full(len(state), np.nan)
    previous = np.nan
    for i, name in enumerate(state):
        if not isinstance(name, str) or name not in _CORE_INDEX_STATES:
            previous = np.nan
            continue
        low, high = _CORE_INDEX_STATES[name][1]
        if name == "NORMAL":
            target = low + (high - low) * np.clip(
                (ext[i] + 0.5) / (p["ext_in"] + 0.5), 0.0, 1.0
            )
        elif name == "TRIM":
            target = low + (high - low) * np.clip(
                (ext[i] - p["ext_in"]) / 1.5, 0.0, 1.0
            )
        elif name == "WARNING":
            target = high - (high - low) * np.clip(-dd[i] / 0.35, 0.0, 1.0)
        else:
            target = high - (high - low) * np.clip(-dd[i] / 0.50, 0.0, 1.0)
        value = (
            target
            if not np.isfinite(previous)
            else previous + alpha * (target - previous)
        )
        out[i] = min(max(value, low), high)
        previous = out[i]
    return out


def _core_index_trend_warning(spx: pd.Series) -> pd.Series:
    """Trend warning on the weekly equity input of v2 (one row per Friday).

    True when the Friday close is below the simple average of the last
    ``CORE_INDEX_TREND_WEEKS`` Friday closes, this one included; a tie is not
    a warning. Missing where the daily S&P source is absent and until 40
    Friday closes in a row exist (warm-up, which restarts after a gap). It
    reads nothing else, so it never depends on the Core Index state.
    """
    weeks = int(CORE_INDEX_TREND_WEEKS)
    close = pd.to_numeric(spx, errors="coerce").astype(float)
    average = close.rolling(weeks, min_periods=weeks).mean()
    known = (close.notna() & average.notna()).to_numpy(dtype=bool)
    below = (close < average).to_numpy(dtype=bool)
    return pd.Series(
        pd.array(
            [bool(flag) if ok else None for flag, ok in zip(below, known)],
            dtype="boolean",
        ),
        index=spx.index,
        name="core_index_trend_warning",
    )


def _core_index_fast_warning(frame: pd.DataFrame) -> pd.Series:
    """Fast warning on the daily calendar: the S&P close is 7% or more below
    the close known 14 calendar days earlier.

    The close is the source-chained equity proxy kept only on daily-close
    segments (``CORE_INDEX_DAILY_EQUITY_SOURCES``), the same input as the Core
    Index and the trend warning, known the same day. Missing where that close
    or the close 14 days earlier is missing, or where any day between them has
    no daily close (the warm-up restarts after a gap). The change is rounded to
    10 decimals so float noise cannot flip an exact -7% (which is a warning).
    Reads nothing else, so it never depends on the Core Index or FRED inputs.
    """
    frame = frame.sort_index()
    index = frame.index
    close = pd.Series(np.nan, index=index, dtype="float64")
    if {"sp500_proxy", "sp500_proxy_source"}.issubset(frame.columns):
        chained = _continuous_proxy(frame)
        source = frame["sp500_proxy_source"].astype("string")
        daily = source.isin(list(CORE_INDEX_DAILY_EQUITY_SOURCES)).fillna(False).astype(bool)
        close = chained.where(daily).astype("float64")
    days = int(CORE_INDEX_FAST_DAYS)
    # the value of the latest row on or before d - 14 days (its NaN kept), i.e. the close known on that day
    base = close.reindex(index - pd.Timedelta(days=days), method="ffill").to_numpy(dtype=float)
    now = close.to_numpy(dtype=float)
    # no missing close anywhere in [d - 14, d]: a window across a gap gives no reading (warm-up restarts)
    gap_free = (
        close.isna().astype("float64").rolling(f"{days + 1}D").sum().eq(0.0).to_numpy(dtype=bool)
    )
    with np.errstate(divide="ignore", invalid="ignore"):
        change = np.round(now / base - 1.0, 10)
    known = np.isfinite(change) & gap_free
    warn = change <= -float(CORE_INDEX_FAST_DROP)
    return pd.Series(
        pd.array([bool(w) if k else None for w, k in zip(warn, known)], dtype="boolean"),
        index=index,
        name="core_index_fast_warning",
    )


def calculate_core_index_v2_weekly(frame: pd.DataFrame) -> pd.DataFrame:
    """Core Index v2 on the Fridays of ``frame``'s daily calendar.

    ``frame`` is the daily calendar with native series forward-filled and raw
    FRED stamps; publication lags are applied here. The trend warning is
    computed from the same Friday equity input but has its own warm-up, so
    it can be known on Fridays where the Core Index is not. The fast warning
    is daily, not weekly, so it is not here: ``calculate_core_index_v2`` adds
    it on the daily calendar.
    """
    frame = frame.sort_index()
    inputs = _core_index_v2_inputs(frame)
    features = _core_index_v2_features(inputs)
    state, severity, warning = _core_index_v2_state(features)
    raw_score = _core_index_v2_score(
        state,
        features["ext"].to_numpy(dtype=float),
        features["dd52"].to_numpy(dtype=float),
    )
    score = pd.Series(raw_score, index=inputs.index, dtype="float64").round(4)
    has = np.array([isinstance(name, str) for name in state], dtype=bool)
    out = pd.DataFrame(index=inputs.index)
    out["core_index"] = score.where(has)
    out["core_index_composite"] = (score + 50.0).where(has)
    out["core_index_bucket"] = pd.array(
        [_CORE_INDEX_STATES[name][0] if ok else None for name, ok in zip(state, has)],
        dtype="string",
    )
    out["core_index_severity"] = pd.array(
        [level if ok else None for level, ok in zip(severity, has)],
        dtype="string",
    )
    out["core_index_warning"] = pd.array(
        [bool(flag) if ok else None for flag, ok in zip(warning, has)],
        dtype="boolean",
    )
    out["core_index_trend_warning"] = _core_index_trend_warning(features["spx"])
    return out


def calculate_core_index_v2(frame: pd.DataFrame) -> pd.DataFrame:
    """Daily-calendar Core Index v2 columns (``CORE_INDEX_V2_COLUMNS``).

    Each day carries the decision of the latest Friday on or before it, so
    the Friday-close value holds Saturday to Thursday. Days before the first
    scored Friday are missing (before the first trend-warning Friday for
    ``core_index_trend_warning``, which needs 40 Friday closes, not 53).
    The exception is ``core_index_fast_warning``, which is daily: decided at
    each day's close, known from the 14th day of daily closes.
    """
    frame = frame.sort_index()
    weekly = calculate_core_index_v2_weekly(frame)
    # reindex(method="ffill") takes the row of the latest Friday on or before
    # each day and keeps that row's missing values.
    daily = weekly.reindex(frame.index, method="ffill")
    # The fast warning is decided every day on the daily calendar, not on Fridays.
    daily["core_index_fast_warning"] = _core_index_fast_warning(frame)
    return daily[list(CORE_INDEX_V2_COLUMNS)]


def calculate_core_index(frame: pd.DataFrame) -> pd.DataFrame:
    """Compute the StrikeHike Core Index (v2) plus the legacy v1 diagnostics.

    Returns the 16 v1 diagnostic columns (unchanged values; descriptive only,
    not v2 inputs), then ``core_index_composite``, ``core_index``,
    ``core_index_bucket``, ``core_index_severity``, ``core_index_warning``,
    ``core_index_trend_warning`` and ``core_index_fast_warning`` from
    ``calculate_core_index_v2``.

    v2 is a weekly trend-and-stress state machine decided at each Friday
    close: the daily-sourced equity proxy against its 40-week average and its
    own volatility, with credit spreads, unemployment and the yield curve as
    stress flags, each lagged by its publication delay. The four buckets keep
    their allocation meaning; severity describes the decline under way. The
    trend warning is a separate, more sensitive flag (Friday close below the
    average of the last 40 Friday closes) that changes nothing in the index.
    The fast warning is a separate daily flag (the S&P close 7% or more below
    the close 14 days earlier), a reaction to a sharp fall that also changes
    nothing in the index. None of them is a forecast.
    """
    out = calculate_core_index_v1(frame).drop(
        columns=["core_index_composite", "core_index", "core_index_bucket"]
    )
    v2 = calculate_core_index_v2(frame).reindex(frame.index)
    for column in (
        "core_index_composite",
        "core_index",
        "core_index_bucket",
        "core_index_severity",
        "core_index_warning",
        "core_index_trend_warning",
        "core_index_fast_warning",
    ):
        out[column] = v2[column]
    return out


def core_index_trend_metadata(frame: pd.DataFrame) -> dict[str, Any]:
    """The ``core_index.trend_warning`` metadata block: the definition, the
    first Friday it is known and the measured record."""
    first = None
    if "core_index_trend_warning" in frame.columns:
        known = frame["core_index_trend_warning"].dropna()
        if not known.empty:
            first = known.index.min().date().isoformat()
    return {
        "version": CORE_INDEX_TREND_VERSION,
        "column": "core_index_trend_warning",
        "rule": CORE_INDEX_TREND_RULE,
        "weeks": int(CORE_INDEX_TREND_WEEKS),
        "input": "sp500_proxy (chained, daily sources only), the Core Index's Friday close",
        "cadence": "weekly",
        "fitted": False,
        "changes_core_index": False,
        "first_value": first,
        "record": copy.deepcopy(CORE_INDEX_TREND_RECORD),
    }


def core_index_fast_metadata(frame: pd.DataFrame) -> dict[str, Any]:
    """The ``core_index.fast_warning`` metadata block: the definition, the
    first day it is known and the measured record."""
    first = None
    if "core_index_fast_warning" in frame.columns:
        known = frame["core_index_fast_warning"].dropna()
        if not known.empty:
            first = known.index.min().date().isoformat()
    return {
        "version": CORE_INDEX_FAST_VERSION,
        "column": "core_index_fast_warning",
        "rule": CORE_INDEX_FAST_RULE,
        "days": int(CORE_INDEX_FAST_DAYS),
        "drop": float(CORE_INDEX_FAST_DROP),
        "input": "sp500_proxy (chained, daily sources only), the Core Index's daily close",
        "cadence": "daily",
        "fitted": False,
        "chosen_after_seeing_history": True,
        "forecast": False,
        "changes_core_index": False,
        "first_value": first,
        "record": copy.deepcopy(CORE_INDEX_FAST_RECORD),
    }


def core_index_metadata(frame: pd.DataFrame) -> dict[str, Any]:
    """The artifact metadata ``core_index`` block for a frame holding the v2
    columns (the ingestion pipeline and the recompute script share it)."""
    block: dict[str, Any] = {
        "version": CORE_INDEX_VERSION,
        "method": CORE_INDEX_METHOD,
        "cadence": "weekly",
        "first_scored": None,
        "weights": dict(CORE_INDEX_WEIGHTS),
        "features": list(CORE_INDEX_FEATURES),
        "input_lags": {
            column: {"months": months, "days": days}
            for column, (months, days) in CORE_INDEX_INPUT_LAGS.items()
        },
        "parameters": dict(CORE_INDEX_PARAMS),
        "buckets": dict(CORE_INDEX_BUCKET_RANGES),
        "severities": list(CORE_INDEX_SEVERITIES),
        "legacy_v1_columns": list(CORE_INDEX_V1_LEGACY_COLUMNS),
        "trend_warning": core_index_trend_metadata(frame),
        "fast_warning": core_index_fast_metadata(frame),
        "latest": None,
    }
    if "core_index" not in frame.columns:
        return block
    scored = pd.to_numeric(frame["core_index"], errors="coerce").dropna()
    if scored.empty:
        return block
    first = scored.index.min()
    last = scored.index.max()
    # The Friday whose close decided the value carried on ``last``.
    signal = last - pd.Timedelta(days=(last.dayofweek - 4) % 7)

    def _value(column: str) -> Any:
        return frame.loc[last, column] if column in frame.columns else None

    composite = _as_float(_value("core_index_composite"), 2)
    block["first_scored"] = first.date().isoformat()
    block["latest"] = {
        "date": last.date().isoformat(),
        "signal_date": signal.date().isoformat(),
        "score": round(float(scored.loc[last]), 2),
        "composite": composite,
        "bucket": _as_str(_value("core_index_bucket")),
        "severity": _as_str(_value("core_index_severity")),
        "warning": _as_bool(_value("core_index_warning")),
        "trend_warning": _as_bool(_value("core_index_trend_warning")),
        # Decided at the close of ``date`` itself (daily), not at signal_date.
        "fast_warning": _as_bool(_value("core_index_fast_warning")),
    }
    return block


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
        "core_index_severity": None,
        "core_index_warning": None,
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
        "core_index_severity": _as_str(row.get("core_index_severity")),
        "core_index_warning": _as_bool(row.get("core_index_warning")),
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

# Daily S&P composite closes from Yahoo Finance (^GSPC), 1927-12-30 onward.
# The merged frame carries them as SP500_DAILY_COLUMN and sp500_proxy_source
# labels them SP500_DAILY_SOURCE. Before 1957-03-04 the index is the S&P 90.
SP500_DAILY_COLUMN = "GSPC"
SP500_DAILY_SOURCE = "YAHOO_FINANCE_GSPC"

# (frame column, sp500_proxy_source label) in priority order: on each date the
# first source with a value wins.
SP500_PROXY_SOURCES: tuple[tuple[str, str], ...] = (
    (SP500_DAILY_COLUMN, SP500_DAILY_SOURCE),
    ("M1125AUSM343NNBR", "M1125AUSM343NNBR"),
    ("SP500", "SP500"),
)


def build_sp500_proxy(
    frame: pd.DataFrame,
    *,
    raw_frame: pd.DataFrame | None = None,
) -> pd.DataFrame:
    """Build the long-run S&P series, daily S&P closes first.

    Priority order (``SP500_PROXY_SOURCES``):

    1. ``GSPC``             - daily S&P composite close from Yahoo Finance
       (^GSPC), 1927-12-30 onward; the ingestion pipeline swaps in FRED's
       official close where the two disagree. Before 1957-03-04 that index is
       the S&P 90, the S&P 500's predecessor.
    2. ``M1125AUSM343NNBR`` - NBER/Cowles monthly common-stock index
       (1935-39=100). It fills only the dates before the first daily ^GSPC
       close (all of 1871-1956 if the Yahoo series is missing).
    3. ``SP500``            - FRED S&P 500, a ten-year licence window. It is a
       fallback for dates the Yahoo series does not reach.

    The Dow-Jones (``M1109BUSM293NNBR``) and Nasdaq (``NASDAQCOM``) series are
    never used: they are different indexes, not S&P levels.

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

    for column, label in SP500_PROXY_SOURCES:
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
        source.loc[mask] = label

    return pd.DataFrame(
        {"sp500_proxy": proxy, "sp500_proxy_source": source},
        index=frame.index,
    )
