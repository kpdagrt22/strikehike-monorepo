"""Convergence case catalogue: market declines found in the macro artifact.

A case is a decline on one market series: a peak, a low and, when the data
shows it, the first return to that peak. Each of those dates is a native
observation of the case's own series, found by one documented rule per market
(``KIND_RULES``). No case date is written into this module. NBER recessions
are context (``recessions``), not cases.

The catalogue and the aligned paths are computed from the committed parquet at
request time and cached until the parquet, its meta file or the events file
changes, so the parquet stays the single source of truth (``CaseStore``).

US stocks are the eras of ``sp500_proxy``: the Cowles monthly index (monthly
averages, Cowles units) until the first daily S&P close, then the daily S&P
composite close (the S&P 90 before 4 Mar 1957, the S&P 500 from that day).
Levels are comparable only inside one unit family, so episodes are detected
inside one era on raw levels. Paths chain the eras with a zero return where
the unit family changes and list each change in ``splices``. A run of missing
days (a gap) ends a path and makes a recovery after it unobservable.
"""

from __future__ import annotations

import json
import logging
import math
import re
import threading
import time
from bisect import bisect_left
from collections import OrderedDict
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Any, Iterable

import numpy as np
import pandas as pd

from regime.analytics import CRASH_NAMES, nber_episodes
from regime.crypto_milestones import milestone_definitions

logger = logging.getLogger(__name__)

CASES_VERSION = "regime-cases-v1"

BACKEND_DIR = Path(__file__).resolve().parents[1]
# The same files regime.service reads. They are not imported from there so
# that the service can import this module without an import cycle.
DEFAULT_ARTIFACT = BACKEND_DIR / "data" / "processed" / "macro_regime_history.parquet"
DEFAULT_META = BACKEND_DIR / "data" / "processed" / "macro_regime_history.meta.json"
DEFAULT_EVENTS = BACKEND_DIR / "data" / "historical_events.json"

# ---------------------------------------------------------------------------
# Method dates: rule boundaries, never case dates. Every ISO date literal in
# this module is one of these (tests/test_regime_cases.py checks it).
# ---------------------------------------------------------------------------

EPHEMERIS_START = "1900-01-01"  # sky coverage of app/api/chrono/positions
EPHEMERIS_END = "2035-12-31"
BTC_PEAKS_FROM = "2011-01-01"  # 2010 Bitcoin prices were USD 0.06-0.47
GOLD_FLOAT_FROM = "1968-01-01"  # the World Bank series is the USD 35 official price before 1968
SP500_INDEX_START = "1957-03-04"  # ^GSPC is the S&P 90 before this day and the S&P 500 from it
METHOD_DATES = {
    "EPHEMERIS_START": EPHEMERIS_START,
    "EPHEMERIS_END": EPHEMERIS_END,
    "BTC_PEAKS_FROM": BTC_PEAKS_FROM,
    "GOLD_FLOAT_FROM": GOLD_FLOAT_FROM,
    "SP500_INDEX_START": SP500_INDEX_START,
}

# ---------------------------------------------------------------------------
# Rules and limits
# ---------------------------------------------------------------------------

EVENT_LOOKBACK_DAYS = 30  # events this close before the peak belong to the decline
STALE_READING_DAYS = 7  # a Core Index / macro reading older than this is null
GAP_MIN_DAYS = 45  # a longer run of missing days splits a series into eras
PATH_UNTIL_DAYS = 10_000
PATH_ALL_POINTS_DAYS = 730
PATH_WEEKLY_UNTIL_DAYS = 3_650
BASE_TOLERANCE_DAYS = {"daily": 31, "monthly": 62}
ALLOWED_FROM_DAYS = (0, -90, -365, -730)
ALIGNMENTS = ("peak", "latest")
SERIES_KEYS = ("sp500", "gold", "bonds", "nifty", "bitcoin")
PATH_SERIES = ("own",) + SERIES_KEYS
TODAY_ID = "today"
CASE_ID_PATTERN = r"^(today|[a-z0-9-]{3,48})$"
DESCRIPTION_MAX = 120
SHORT_NAME_MAX = 16
CURATED_PEAK_MONTHS = 1
CURATED_TROUGH_MONTHS = 2
CRYPTO_ALIAS_DAYS = 3
# The path LRU keeps serialized JSON (a median path is about 19 KB), bounded by
# entry count and by total bytes, so with keys and object overhead it stays
# under 6.4 MB. Python lists of the same paths took about 0.1 MB each.
PATH_CACHE_SIZE = 256
PATH_CACHE_BYTES = 6_000_000


@dataclass(frozen=True)
class KindRule:
    key: str
    label: str
    region: str
    series: str
    id_prefix: str
    threshold: float
    rebound_daily: float
    rebound_monthly: float
    peaks_from: str | None = None


# An episode opens at a fall of ``threshold`` below the running high and
# closes when the series regains that high or rebounds by the rebound share
# from its low (monthly averages damp swings, hence the smaller monthly value).
KIND_RULES: dict[str, KindRule] = {
    "us_equity": KindRule("us_equity", "US stocks", "US", "sp500", "us-equity", 0.15, 0.50, 0.25),
    "india_equity": KindRule("india_equity", "India · Nifty 50", "India", "nifty", "nifty", 0.15, 0.50, 0.25),
    "bitcoin": KindRule("bitcoin", "Bitcoin", "Global", "bitcoin", "btc", 0.50, 1.00, 1.00, BTC_PEAKS_FROM),
    "gold": KindRule("gold", "Gold", "Global", "gold", "gold", 0.25, 0.25, 0.25),
    "treasury": KindRule("treasury", "Treasury bonds", "US", "bonds", "ust", 0.15, 0.50, 0.25),
}


@dataclass(frozen=True)
class SeriesSpec:
    key: str
    column: str
    source_column: str
    display: str  # "No {display} observation within ..."
    weekdays_only: bool  # applies to daily eras only
    start: str | None = None


SERIES_SPECS: dict[str, SeriesSpec] = {
    "sp500": SeriesSpec("sp500", "sp500_proxy", "sp500_proxy_source", "US stock", True),
    "gold": SeriesSpec("gold", "gold_proxy", "gold_proxy_source", "gold", False, GOLD_FLOAT_FROM),
    "bonds": SeriesSpec("bonds", "bond_proxy", "bond_proxy_source", "Treasury model", True),
    "nifty": SeriesSpec("nifty", "nifty_proxy", "nifty_proxy_source", "Nifty 50", True),
    "bitcoin": SeriesSpec("bitcoin", "btc_proxy", "btc_proxy_source", "Bitcoin", False),
}
COLUMN_TO_KEY = {spec.column: key for key, spec in SERIES_SPECS.items()}


@dataclass(frozen=True)
class SourceInfo:
    family: str  # unit family: levels compare only inside one family
    index: str  # index name, used in path labels
    label: str  # series line of a case
    word: str  # subject of a case description
    prefix: str  # index of a neutral name ("S&P 500 decline of 2018")
    tag: str  # short-name tag ("S&P 2018")


_SP90 = SourceInfo("sp", "S&P 90", "S&P 90 (S&P 500 predecessor), daily close", "S&P 90", "S&P 90", "S&P")
_SP500 = SourceInfo("sp", "S&P 500", "S&P 500, daily close", "S&P 500", "S&P 500", "S&P")
# Yahoo ^GSPC and FRED SP500 (the fallback for days Yahoo does not reach) are
# the same index in the same units, so they form one family.
SP_SOURCES = frozenset({"YAHOO_FINANCE_GSPC", "SP500"})
SOURCE_INFO: dict[str, SourceInfo] = {
    "M1125AUSM343NNBR": SourceInfo(
        "cowles", "Cowles index", "Cowles US stock index, monthly average", "Cowles index", "US stock", "US"
    ),
    "YAHOO_FINANCE_NSEI": SourceInfo("nifty", "Nifty 50", "Nifty 50, daily close", "Nifty 50", "Nifty 50", "Nifty"),
    "BLOCKCHAIN_COM_MARKET_PRICE": SourceInfo(
        "bitcoin", "Bitcoin", "Bitcoin, Blockchain.com daily price", "Bitcoin", "Bitcoin", "BTC"
    ),
    "WORLD_BANK_LBMA_GOLD": SourceInfo(
        "gold", "Gold", "Gold, London monthly average (World Bank)", "gold", "Gold", "Gold"
    ),
    "UST10Y_TOTAL_RETURN_PROXY": SourceInfo(
        "ust",
        "10-year Treasury model",
        "10-year Treasury total-return model (duration 7.5)",
        "the Treasury model",
        "Treasury bond",
        "Bonds",
    ),
    # Earlier artifacts spliced these into sp500_proxy; kept so such a file still reads.
    "M1109BUSM293NNBR": SourceInfo(
        "dow", "Dow Jones", "Dow Jones Industrial Average, monthly average", "Dow Jones", "Dow Jones", "Dow"
    ),
    "NASDAQCOM": SourceInfo(
        "nasdaq", "Nasdaq Composite", "Nasdaq Composite, daily close", "Nasdaq Composite", "Nasdaq", "Nasdaq"
    ),
}
FALLBACK_INFO: dict[str, SourceInfo] = {
    "sp500": SourceInfo("", "US stocks", "US stock series", "US stocks", "US stock", "US"),
    "gold": SourceInfo("", "Gold", "Gold series", "gold", "Gold", "Gold"),
    "bonds": SourceInfo("", "Treasury bonds", "Treasury bond series", "Treasury bonds", "Treasury bond", "Bonds"),
    "nifty": SourceInfo("", "Nifty 50", "Nifty 50 series", "Nifty 50", "Nifty 50", "Nifty"),
    "bitcoin": SourceInfo("", "Bitcoin", "Bitcoin series", "Bitcoin", "Bitcoin", "BTC"),
}


@dataclass(frozen=True)
class CuratedName:
    kind: str
    peak_month: str
    trough_month: str
    name: str
    short_name: str
    aka: tuple[str, ...] = ()


# Common historical names, applied only when the detected peak month is within
# one month and the trough month within two months of the entry; otherwise the
# case keeps its neutral name and a warning is logged. Each US entry was
# checked against the daily S&P (or Cowles before 1928) dates. ``aka`` is
# search-only. Causal names are never used.
CURATED_NAMES: tuple[CuratedName, ...] = (
    CuratedName("us_equity", "1906-09", "1907-11", "Panic of 1907", "1907 Panic"),
    CuratedName(
        "us_equity", "1929-09", "1932-06", "Wall Street Crash of 1929", "1929 Crash", ("Great Crash", "Crash of 1929")
    ),
    CuratedName(
        "us_equity", "1961-12", "1962-06", "Kennedy Slide of 1962", "Kennedy Slide", ("Flash Crash of 1962",)
    ),
    CuratedName("us_equity", "1973-01", "1974-10", "1973–74 stock market crash", "1973–74 crash"),
    CuratedName(
        "us_equity", "1987-08", "1987-12", "1987 stock market crash", "1987 crash", ("Black Monday", "Crash of 1987")
    ),
    CuratedName("us_equity", "2000-03", "2002-10", "Dot-com bust", "Dot-com", ("dot-com bubble",)),
    CuratedName(
        "us_equity",
        "2007-10",
        "2009-03",
        "Global Financial Crisis",
        "GFC",
        ("2008 financial crisis", "subprime crisis"),
    ),
    CuratedName(
        "us_equity", "2020-02", "2020-03", "COVID-19 crash", "COVID-19", ("2020 stock market crash", "coronavirus crash")
    ),
    CuratedName("us_equity", "2022-01", "2022-10", "2022 bear market", "2022 bear"),
    CuratedName(
        "india_equity",
        "2008-01",
        "2008-10",
        "Global Financial Crisis (Nifty 50)",
        "GFC · Nifty",
        ("2008 financial crisis",),
    ),
    CuratedName(
        "india_equity", "2020-01", "2020-03", "COVID-19 crash (Nifty 50)", "COVID · Nifty", ("coronavirus crash",)
    ),
    CuratedName(
        "bitcoin", "2017-12", "2018-12", "Crypto Winter", "Crypto Winter", ("2018 crypto crash", "ICO bubble")
    ),
)

# Cause-free context names, overriding CRASH_NAMES (which this release leaves
# unchanged) for the recession list. Keyed by NBER peak month.
RECESSION_NAMES: dict[str, str] = {
    "1860-10": "Recession of 1860–61",
    "1945-02": "Recession of 1945",
    "1973-11": "1973–75 recession",
    "1980-01": "1980 recession",
    "1981-07": "1981–82 recession",
    "1990-07": "1990–91 recession",
    "2001-03": "2001 recession",
    "2007-12": "Great Recession",
    "2020-02": "COVID-19 recession",
}
# Editorial crypto milestones that survive as dated events in Bitcoin cases:
# id -> (event name, which editorial date marks it).
CRYPTO_EVENTS: dict[str, tuple[str, str]] = {
    "mt-gox": ("Mt. Gox Collapse", "trough"),
    "terra-luna": ("Terra-LUNA Collapse", "window"),
}
# Editorial peaks that become search aliases of the Bitcoin case peaking
# within CRYPTO_ALIAS_DAYS of them.
CRYPTO_ALIASES: dict[str, str] = {"spot-etf-peak": "spot ETF peak", "ico-bubble": "ICO bubble"}
# Event names that would contradict a case's own dates. Empty since the US
# series became the daily S&P: "Dot-com peak" (24 Mar 2000) is now the Dot-com
# case's own peak, not a second peak on another index.
EVENT_EXCLUDE: frozenset[str] = frozenset()

PAIRS: tuple[tuple[str, str], ...] = (
    ("us-equity-1929-09", "us-equity-2007-10"),
    ("us-equity-2020-02", "us-equity-1987-08"),
    ("us-equity-2000-03", "us-equity-2022-01"),
    ("nifty-2008-01", "us-equity-2007-10"),
    ("btc-2017-12", "us-equity-2000-03"),
    ("us-equity-1973-01", "us-equity-2022-01"),
)
DEFAULT_PAIR = ("us-equity-2007-10", "us-equity-2020-02")

FRAME_COLUMNS = (
    "sp500_proxy",
    "sp500_proxy_source",
    "nifty_proxy",
    "nifty_proxy_source",
    "gold_proxy",
    "gold_proxy_source",
    "bond_proxy",
    "bond_proxy_source",
    "btc_proxy",
    "btc_proxy_source",
    "nber_recession",
    "core_index",
    "core_index_bucket",
    "macro_strength",
    "macro_strength_coverage",
    "regime_state",
)


class UnknownCaseError(KeyError):
    """The case id is not in the catalogue (the router maps it to 404)."""

    def __init__(self, case_id: str) -> None:
        super().__init__(case_id)
        self.case_id = case_id

    def __str__(self) -> str:
        return f"No case with id {self.case_id!r} in the catalogue."


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------


def _ts(value: Any) -> pd.Timestamp:
    timestamp = pd.Timestamp(value)
    return timestamp.tz_localize("UTC") if timestamp.tzinfo is None else timestamp.tz_convert("UTC")


_SP500_START = _ts(SP500_INDEX_START)


def _iso(timestamp: Any) -> str | None:
    return None if timestamp is None else pd.Timestamp(timestamp).date().isoformat()


def _round(value: Any, digits: int) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(number):
        return None
    return round(number, digits) + 0.0  # + 0.0 turns -0.0 into 0.0


def _pct(value: float, base: float, digits: int) -> float | None:
    return _round((value / base - 1.0) * 100.0, digits) if base else None


def _fmt_day(timestamp: pd.Timestamp) -> str:
    return f"{timestamp.day} {timestamp.strftime('%b %Y')}"


def _fmt_month(timestamp: pd.Timestamp) -> str:
    return timestamp.strftime("%b %Y")


def _month_floor(timestamp: pd.Timestamp) -> pd.Timestamp:
    return timestamp.normalize().replace(day=1)


def _month_end(timestamp: pd.Timestamp) -> pd.Timestamp:
    return (_month_floor(timestamp) + pd.offsets.MonthEnd(0)).normalize()


def _months_from(timestamp: pd.Timestamp, month: str) -> int:
    return (timestamp.year - int(month[:4])) * 12 + timestamp.month - int(month[5:7])


def _years_label(start: pd.Timestamp, end: pd.Timestamp) -> str:
    if start.year == end.year:
        return str(start.year)
    if start.year // 100 == end.year // 100:
        return f"{start.year}–{end.year % 100:02d}"
    return f"{start.year}–{end.year}"


def _en_dash_years(name: str) -> str:
    return re.sub(r"(\d{4})-(\d{2,4})", "\\1–\\2", name)


def _labels(values: pd.Series) -> np.ndarray:
    """Source labels as an object array of str or None (pandas 2 and 3)."""
    codes, uniques = pd.factorize(values)
    table = np.array([str(item) for item in uniques] + [None], dtype=object)
    return table[codes]


def _read_json(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return payload if isinstance(payload, dict) else {}


def source_info(key: str, source: str | None, when: pd.Timestamp | None = None) -> SourceInfo:
    """Description of one source label; S&P labels depend on the date."""
    if source in SP_SOURCES:
        return _SP90 if when is not None and when < _SP500_START else _SP500
    info = SOURCE_INFO.get(source or "")
    if info is not None:
        return info
    return replace(FALLBACK_INFO[key], family=f"{key}:{source or 'unlabelled'}")


def _info_between(key: str, source: str | None, start: pd.Timestamp, end: pd.Timestamp) -> SourceInfo:
    """Source description for an interval; marks a decline that spans the S&P 90 -> 500 change."""
    first = source_info(key, source, start)
    last = source_info(key, source, end)
    if first == last:
        return first
    return replace(
        first,
        index=f"{first.index} → {last.index}",
        label=f"{first.word} → {last.word}, daily close",
        word=f"{first.word} → {last.word}",
    )


# ---------------------------------------------------------------------------
# Observations and episode detection
# ---------------------------------------------------------------------------


def observations(series: pd.Series, *, weekdays_only: bool) -> pd.Series:
    """Native observations of a forward-filled daily-calendar series.

    The parquet is a daily calendar forward-filled from native frequency, so a
    value equal to the previous calendar day is a fill (a weekend, a holiday
    or the rest of a month). Dropping those rows leaves trading days for daily
    series and month starts for monthly series. A real close equal to the
    previous close is dropped too; the earlier of the two is then the date.
    """
    values = pd.to_numeric(series, errors="coerce").dropna().astype("float64")
    values = values[values.ne(values.shift())]
    if weekdays_only:
        values = values[values.index.dayofweek < 5]
    return values


@dataclass
class Episode:
    peak: pd.Timestamp
    trough: pd.Timestamp
    close: pd.Timestamp | None
    closed_by: str  # "recovery" | "rebound" | "open"


def detect_episodes(obs: pd.Series, threshold: float, rebound: float | None) -> list[Episode]:
    """Peak-to-trough episodes of at least ``threshold`` (one pass).

    Up state: track the running high; an equal high moves the peak to the
    latest one. A fall of ``threshold`` below it opens an episode.
    Down state: track the low; an equal low keeps the first. The episode
    closes when the series regains the peak or rises ``rebound`` above the
    low, whichever comes first.
    """
    values = obs.to_numpy(dtype="float64")
    index = obs.index
    episodes: list[Episode] = []
    state = "up"
    peak_i = 0
    trough_i = 0
    for t in range(len(values)):
        value = values[t]
        if state == "up":
            if value >= values[peak_i]:
                peak_i = t
            elif value <= values[peak_i] * (1.0 - threshold):
                state = "down"
                trough_i = t
        else:
            if value < values[trough_i]:
                trough_i = t
            if value >= values[peak_i]:
                episodes.append(Episode(index[peak_i], index[trough_i], index[t], "recovery"))
                state, peak_i = "up", t
            elif rebound is not None and value >= values[trough_i] * (1.0 + rebound):
                episodes.append(Episode(index[peak_i], index[trough_i], index[t], "rebound"))
                state, peak_i = "up", t
    if state == "down":
        episodes.append(Episode(index[peak_i], index[trough_i], None, "open"))
    return episodes


def recovery_date(obs: pd.Series, episode: Episode) -> pd.Timestamp | None:
    """First observation after the trough at or above the peak level."""
    peak_value = float(obs.loc[episode.peak])
    after = obs.loc[episode.trough :]
    hit = after[after >= peak_value]
    return hit.index[0] if len(hit) else None


def window_stats(frame: pd.DataFrame, start: Any, end: Any, column: str) -> dict[str, Any] | None:
    """Time-ordered peak-to-trough statistics for one asset inside a window.

    Drop-in replacement for ``service._event_window_stats``, which took the
    window maximum and minimum regardless of order (a "peak" after the
    "trough"). Here the trough is the largest fall below the running high and
    the peak is the high it fell from, so ``peak_date <= trough_date`` and a
    rising window has ``drawdown_pct == 0.0``. Percentages are chained with a
    zero return where the source's unit family changes; the level fields are
    left out (None) when the window spans more than one unit family.
    """
    if column not in frame.columns:
        return None
    levels = pd.to_numeric(frame[column], errors="coerce").loc[start:end].dropna()
    if levels.empty:
        return None
    values = levels.to_numpy(dtype="float64")
    chained = values.copy()
    families: list[str] | None = None
    source_column = f"{column}_source"
    if source_column in frame.columns:
        key = COLUMN_TO_KEY.get(column, "sp500")
        labels = _labels(frame[source_column].reindex(levels.index))
        families = [source_info(key, label).family for label in labels]
        factor = 1.0
        for i in range(1, len(values)):
            if families[i] != families[i - 1] and values[i] > 0:
                factor = chained[i - 1] / values[i]
            chained[i] = values[i] * factor
    series = pd.Series(chained, index=levels.index)
    drawdown = series / series.cummax() - 1.0
    trough_date = drawdown.idxmin()
    peak_date = series.loc[:trough_date].idxmax()
    comparable = families is None or len(set(families)) <= 1
    first, last = float(chained[0]), float(chained[-1])
    return {
        "start_value": round(float(values[0]), 4) if comparable else None,
        "peak_value": round(float(levels.loc[peak_date]), 4) if comparable else None,
        "trough_value": round(float(levels.loc[trough_date]), 4) if comparable else None,
        "end_value": round(float(values[-1]), 4) if comparable else None,
        "peak_date": _iso(peak_date),
        "trough_date": _iso(trough_date),
        "drawdown_pct": _round(float(drawdown.min()) * 100.0, 2),
        "return_pct": _round((last / first - 1.0) * 100.0, 2) if first > 0 else None,
        "observations": int(levels.size),
    }


# ---------------------------------------------------------------------------
# Series eras
# ---------------------------------------------------------------------------


@dataclass
class Era:
    key: str
    family: str
    resolution: str  # "daily" | "monthly"
    obs: pd.Series  # raw levels at native observations
    sources: np.ndarray  # source label per observation
    gap_after: tuple[pd.Timestamp, pd.Timestamp] | None  # missing days that follow this era
    offset: int = 0  # position of the first observation in SeriesData arrays

    @property
    def start(self) -> pd.Timestamp:
        return self.obs.index[0]

    @property
    def end(self) -> pd.Timestamp:
        return self.obs.index[-1]

    @property
    def precision(self) -> str:
        return "month" if self.resolution == "monthly" else "day"


@dataclass
class SeriesData:
    """All native observations of one asset, by era, plus a chained copy."""

    key: str
    eras: list[Era]
    index: pd.DatetimeIndex
    raw: np.ndarray
    chain: np.ndarray  # zero return where the unit family changes
    monthly: np.ndarray
    sources: np.ndarray
    families: np.ndarray
    era_of: np.ndarray
    gaps: list[tuple[pd.Timestamp, pd.Timestamp]]

    def position(self, when: pd.Timestamp) -> int:
        """Position of the last observation on or before ``when`` (-1 if none)."""
        return int(self.index.searchsorted(when, side="right")) - 1

    def base(self, when: pd.Timestamp) -> tuple[int, int, str]:
        """(position, tolerance, resolution) of the base observation for ``when``."""
        pos = self.position(when)
        monthly = bool(self.monthly[pos]) if pos >= 0 else bool(self.monthly[0])
        resolution = "monthly" if monthly else "daily"
        tolerance = BASE_TOLERANCE_DAYS[resolution]
        if pos >= 0 and (when - self.index[pos]).days > tolerance:
            pos = -1
        return pos, tolerance, resolution

    def run_end(self, era_no: int) -> int:
        """Last era reached from ``era_no`` without crossing a gap."""
        last = era_no
        while last < len(self.eras) - 1 and self.eras[last].gap_after is None:
            last += 1
        return last


def _resolution(native: pd.Series) -> str:
    if len(native) < 3:
        return "daily"
    spacing = np.asarray((native.index[1:] - native.index[:-1]).days, dtype="float64")
    return "monthly" if float(np.median(spacing)) >= 20.0 else "daily"


def build_series(frame: pd.DataFrame, key: str) -> SeriesData | None:
    """Split one asset column into eras (unit family and gaps) and chain them."""
    spec = SERIES_SPECS[key]
    if spec.column not in frame.columns:
        return None
    levels = pd.to_numeric(frame[spec.column], errors="coerce")
    if spec.start is not None:
        levels = levels.loc[_ts(spec.start) :]
    levels = levels.dropna().astype("float64")
    levels = levels[levels > 0]
    if levels.empty:
        return None
    if spec.source_column in frame.columns:
        labels = _labels(frame[spec.source_column].reindex(levels.index))
    else:
        labels = np.array([None] * len(levels), dtype=object)
    family_of = {label: source_info(key, label).family for label in set(labels.tolist())}
    families = np.array([family_of[label] for label in labels.tolist()], dtype=object)

    stamps = levels.index
    steps = np.asarray((stamps[1:] - stamps[:-1]).days, dtype="int64")
    is_gap = steps > GAP_MIN_DAYS
    cuts = np.nonzero(is_gap | (families[1:] != families[:-1]))[0] + 1
    bounds = [0, *cuts.tolist(), len(levels)]

    eras: list[Era] = []
    for start, stop in zip(bounds[:-1], bounds[1:]):
        piece = levels.iloc[start:stop]
        native = observations(piece, weekdays_only=False)
        resolution = _resolution(native)
        if resolution == "daily" and spec.weekdays_only:
            native = native[native.index.dayofweek < 5]
        if native.empty:
            continue
        gap_after = None
        if stop < len(levels) and is_gap[stop - 1]:
            gap_after = (stamps[stop - 1] + pd.Timedelta(days=1), stamps[stop] - pd.Timedelta(days=1))
        sources = pd.Series(labels[start:stop], index=piece.index, dtype=object).loc[native.index].to_numpy()
        eras.append(Era(key, str(families[start]), resolution, native, sources, gap_after))
    if not eras:
        return None

    # Chain backwards so the current era keeps its own units.
    factors = [1.0] * len(eras)
    for i in range(len(eras) - 2, -1, -1):
        last_here = float(eras[i].obs.iloc[-1])
        first_next = float(eras[i + 1].obs.iloc[0])
        factors[i] = factors[i + 1] * first_next / last_here
    offset = 0
    for era in eras:
        era.offset = offset
        offset += len(era.obs)

    return SeriesData(
        key=key,
        eras=eras,
        index=eras[0].obs.index.append([era.obs.index for era in eras[1:]]),
        raw=np.concatenate([era.obs.to_numpy(dtype="float64") for era in eras]),
        chain=np.concatenate([era.obs.to_numpy(dtype="float64") * factor for era, factor in zip(eras, factors)]),
        monthly=np.concatenate([np.full(len(era.obs), era.resolution == "monthly") for era in eras]),
        sources=np.concatenate([era.sources for era in eras]),
        families=np.concatenate([np.full(len(era.obs), era.family, dtype=object) for era in eras]),
        era_of=np.concatenate([np.full(len(era.obs), number) for number, era in enumerate(eras)]),
        gaps=[era.gap_after for era in eras if era.gap_after is not None],
    )


# ---------------------------------------------------------------------------
# Catalogue
# ---------------------------------------------------------------------------


@dataclass
class CaseContext:
    catalogue: dict[str, Any]
    series: dict[str, SeriesData | None]
    cases_by_id: dict[str, dict[str, Any]]
    core_index: pd.Series
    macro_strength: pd.Series
    warnings: list[str] = field(default_factory=list)
    build_seconds: float | None = None


def _numeric(frame: pd.DataFrame, column: str) -> pd.Series:
    if column not in frame.columns:
        return pd.Series(np.nan, index=frame.index, dtype="float64")
    return pd.to_numeric(frame[column], errors="coerce").astype("float64")


def _text(frame: pd.DataFrame, column: str) -> pd.Series:
    if column not in frame.columns:
        return pd.Series(None, index=frame.index, dtype=object)
    return pd.Series(_labels(frame[column]), index=frame.index, dtype=object)


def _asof(series: pd.Series, when: pd.Timestamp) -> tuple[float | None, pd.Timestamp | None]:
    """Last value on or before ``when`` unless it is more than STALE_READING_DAYS old."""
    if series.empty:
        return None, None
    pos = int(series.index.searchsorted(when, side="right")) - 1
    if pos < 0:
        return None, None
    asof = series.index[pos]
    if (when - asof).days > STALE_READING_DAYS:
        return None, None
    return float(series.iloc[pos]), asof


def _core_index_block(core: pd.Series, bucket: pd.Series, peak, trough) -> dict[str, Any] | None:
    at_peak, peak_asof = _asof(core, peak)
    at_trough, trough_asof = _asof(core, trough)
    if at_peak is None and at_trough is None:
        return None
    return {
        "at_peak": _round(at_peak, 2),
        "at_peak_date": _iso(peak_asof),
        "at_peak_bucket": bucket.get(peak_asof) if peak_asof is not None else None,
        "at_trough": _round(at_trough, 2),
        "at_trough_date": _iso(trough_asof),
        "at_trough_bucket": bucket.get(trough_asof) if trough_asof is not None else None,
    }


def _macro_block(strength: pd.Series, coverage: pd.Series, state: pd.Series, peak, trough) -> dict[str, Any] | None:
    def reading(when):
        value, asof = _asof(strength, when)
        if asof is None:
            return None
        return {"value": _round(value, 2), "regime_state": state.get(asof), "coverage": _round(coverage.get(asof), 3)}

    at_peak, at_trough = reading(peak), reading(trough)
    if at_peak is None and at_trough is None:
        return None
    return {"at_peak": at_peak, "at_trough": at_trough}


def _available(series: SeriesData | None, peak: pd.Timestamp, trough: pd.Timestamp) -> bool:
    """A native observation within tolerance before the peak and data through the trough, no gap between."""
    if series is None:
        return False
    pos, _, _ = series.base(peak)
    if pos < 0 or series.index[-1] < trough:
        return False
    return not any(peak < gap_start <= trough for gap_start, _ in series.gaps)


def _recession_context(frame: pd.DataFrame) -> list[dict[str, Any]]:
    if "nber_recession" not in frame.columns:
        return []
    first_day = frame.index.min()
    items = []
    for episode in nber_episodes(frame):
        if _ts(episode["indicator_start"]) <= first_day:
            continue  # the run starts before the data, so its NBER peak is unknown here
        month = episode["start_month"]
        name = RECESSION_NAMES.get(month) or CRASH_NAMES.get(month) or f"Recession of {month[:4]}"
        items.append(
            {
                "id": episode["id"],
                "name": _en_dash_years(name),
                "start_month": month,
                "end_month": episode["end_month"],
            }
        )
    return items


def _detect_cases(rule: KindRule, series: SeriesData, warnings: list[str]) -> list[dict[str, Any]]:
    """Raw cases (internal fields) for one kind, era by era."""
    found = []
    peaks_from = _ts(rule.peaks_from) if rule.peaks_from else None
    for era_no, era in enumerate(series.eras):
        rebound = rule.rebound_monthly if era.resolution == "monthly" else rule.rebound_daily
        obs = era.obs
        for episode in detect_episodes(obs, rule.threshold, rebound):
            if peaks_from is not None and episode.peak < peaks_from:
                continue
            peak, trough = episode.peak, episode.trough
            peak_pos = era.offset + obs.index.get_loc(peak)
            trough_pos = era.offset + obs.index.get_loc(trough)
            recovery = recovery_date(obs, episode)
            recovery_pos = None if recovery is None else era.offset + obs.index.get_loc(recovery)
            run_last = series.run_end(era_no)
            run_stop = series.eras[run_last].offset + len(series.eras[run_last].obs)
            if recovery is None and run_last > era_no:
                # The decline outlasts its era: look for the recovery on the
                # chained series across the change of unit family. Its low
                # stays the era's low; a deeper later low shows as lower_low.
                warnings.append(f"{rule.key} {_iso(peak)}: decline continues past its {era.family} era")
                start = era.offset + len(obs)
                hit = np.nonzero(series.chain[start:run_stop] >= series.chain[peak_pos] * (1.0 - 1e-12))[0]
                if hit.size:
                    recovery_pos = start + int(hit[0])
                    recovery = series.index[recovery_pos]
            if recovery is not None:
                status = "recovered"
            elif run_last == len(series.eras) - 1:
                status = "not_recovered"
            else:
                status = "unobservable"
            tail_stop = recovery_pos + 1 if recovery_pos is not None else run_stop
            tail = series.chain[trough_pos:tail_stop]
            lower_low = None
            if status != "unobservable" and tail.size and tail.min() < series.chain[trough_pos] * (1.0 - 1e-12):
                low_pos = trough_pos + int(np.argmin(tail))
                lower_low = {
                    "date": _iso(series.index[low_pos]),
                    "pct_from_peak": _pct(series.chain[low_pos], series.chain[peak_pos], 1),
                }
            latest = None
            if status == "not_recovered":
                last_pos = len(series.index) - 1
                latest = {
                    "date": _iso(series.index[last_pos]),
                    "pct_from_peak": _pct(series.chain[last_pos], series.chain[peak_pos], 1),
                }
            found.append(
                {
                    "kind": rule.key,
                    "era": era,
                    "era_no": era_no,
                    "peak": peak,
                    "trough": trough,
                    "recovery": recovery,
                    "status": status,
                    "depth": _pct(float(obs.loc[trough]), float(obs.loc[peak]), 1),
                    "lower_low": lower_low,
                    "latest": latest,
                    "spans_splice": recovery_pos is not None and series.era_of[recovery_pos] != era_no,
                    "source_at_peak": era.sources[obs.index.get_loc(peak)],
                }
            )
    return found


def _curated_match(kind: str, peak, trough, used: set[int]) -> int | None:
    best = None
    for number, entry in enumerate(CURATED_NAMES):
        if entry.kind != kind or number in used:
            continue
        peak_off = abs(_months_from(peak, entry.peak_month))
        trough_off = abs(_months_from(trough, entry.trough_month))
        if peak_off <= CURATED_PEAK_MONTHS and trough_off <= CURATED_TROUGH_MONTHS:
            if best is None or peak_off + trough_off < best[0]:
                best = (peak_off + trough_off, number)
    return None if best is None else best[1]


def _rule_text(rule: KindRule, series: SeriesData | None) -> str:
    threshold = f"Declines of {round(rule.threshold * 100):g}% or more"
    if series is None:
        return threshold
    first = series.index[0]
    if rule.key == "us_equity":
        parts = []
        for era in series.eras:
            if era.family == "sp":
                part = f"S&P daily close from {_fmt_month(era.start)}"
                if era.start < _SP500_START <= era.end:
                    part += f" (the S&P 90 before {_fmt_month(_SP500_START)})"
            else:
                info = source_info("sp500", era.sources[0], era.start)
                kind = "monthly average" if era.resolution == "monthly" else "daily close"
                part = f"{info.word} ({kind}) {era.start.year}–{era.end.year}"
            parts.append(part)
        return f"{threshold} on US stocks: " + ", then ".join(parts)
    texts = {
        "india_equity": f"on the Nifty 50 daily close (from {_fmt_month(first)})",
        "bitcoin": f"on the Bitcoin daily price (peaks from {(rule.peaks_from or _iso(first))[:4]})",
        "gold": f"on the London gold monthly average (from {first.year})",
        "treasury": f"on the 10-year Treasury total-return model (from {first.year})",
    }
    return f"{threshold} {texts.get(rule.key, '')}".strip()


def _segments(series: SeriesData | None) -> list[dict[str, Any]]:
    if series is None:
        return []
    items = []
    for era in series.eras:
        info = _info_between(series.key, era.sources[0], era.start, era.end)
        kind = "monthly average" if era.resolution == "monthly" else "daily close"
        items.append(
            {
                "source": era.sources[0],
                "label": f"{info.index}, {kind}",
                "resolution": era.resolution,
                "start": _iso(era.start),
                "end": _iso(era.end),
            }
        )
    return items


def build_context(
    frame: pd.DataFrame,
    meta: dict[str, Any] | None,
    finance_events: Iterable[dict[str, Any]] | None,
    crypto_definitions: Iterable[dict[str, Any]] | None = None,
) -> CaseContext:
    """Detect every case and build the ``/cases`` payload plus path inputs."""
    frame = frame.copy(deep=False)
    frame.index = pd.to_datetime(frame.index, utc=True)
    frame = frame.sort_index()
    meta = meta or {}
    events = sorted(finance_events or [], key=lambda item: item["date"])
    crypto = {item.get("id"): item for item in (crypto_definitions or milestone_definitions())}
    warnings: list[str] = []

    series = {key: build_series(frame, key) for key in SERIES_KEYS}
    if not any(series.values()):
        raise ValueError("The macro artifact has no market series for the case catalogue.")

    core = _numeric(frame, "core_index")
    strength = _numeric(frame, "macro_strength")
    coverage = _numeric(frame, "macro_strength_coverage")
    bucket = _text(frame, "core_index_bucket")
    state = _text(frame, "regime_state")
    core_clean, strength_clean = core.dropna(), strength.dropna()

    raw_cases: list[dict[str, Any]] = []
    for rule in KIND_RULES.values():
        data = series.get(rule.series)
        if data is not None:
            raw_cases += _detect_cases(rule, data, warnings)

    recessions = _recession_context(frame)
    recession_spans = [
        (item["id"], _ts(item["start_month"] + "-01"), _month_end(_ts(item["end_month"] + "-01")))
        for item in recessions
    ]

    used: set[int] = set()
    cases: list[dict[str, Any]] = []
    for raw in raw_cases:
        rule = KIND_RULES[raw["kind"]]
        era: Era = raw["era"]
        peak, trough, recovery = raw["peak"], raw["trough"], raw["recovery"]
        monthly = era.resolution == "monthly"
        info = _info_between(rule.series, raw["source_at_peak"], peak, trough)
        match = _curated_match(rule.key, peak, trough, used)
        if match is not None:
            used.add(match)
            entry = CURATED_NAMES[match]
            name, short, aka, name_source = entry.name, entry.short_name, list(entry.aka), "curated"
        else:
            years = _years_label(peak, trough)
            name = f"{source_info(rule.series, raw['source_at_peak'], peak).prefix} decline of {years}"
            short = f"{info.tag} {years}"
            aka, name_source = [], "neutral"

        trough_end = _month_end(trough) if monthly else trough
        window_start = peak - pd.Timedelta(days=EVENT_LOOKBACK_DAYS)
        lo, hi = window_start.date().isoformat(), trough_end.date().isoformat()
        case_events = [
            {"date": item["date"], "name": item["name"], "source": "historical_events"}
            for item in events
            if lo <= item["date"] <= hi and item["name"] not in EVENT_EXCLUDE
        ]
        if rule.key == "bitcoin":
            for milestone_id, (label, marker) in CRYPTO_EVENTS.items():
                definition = crypto.get(milestone_id) or {}
                window = definition.get("window") or {}
                when = definition.get("trough") if marker == "trough" else window.get("start")
                if when and lo <= str(when) <= hi:
                    item = {"date": str(when), "name": label, "source": "crypto_milestones"}
                    if marker == "window" and window.get("end"):
                        item["end"] = str(window["end"])
                    case_events.append(item)
            for milestone_id, alias in CRYPTO_ALIASES.items():
                editorial = (crypto.get(milestone_id) or {}).get("peak")
                if editorial and abs((_ts(editorial) - peak).days) <= CRYPTO_ALIAS_DAYS and alias not in aka:
                    aka.append(alias)
        case_events.sort(key=lambda item: item["date"])

        span_start = _month_floor(peak) if monthly else peak
        overlaps = [rid for rid, start, end in recession_spans if span_start <= end and start <= trough_end]

        fmt = _fmt_month if monthly else _fmt_day
        word = info.word[0].upper() + info.word[1:]
        description = f"{word} fell {abs(raw['depth']):.1f}% from {fmt(peak)} to {fmt(trough)}"
        if raw["status"] == "recovered":
            description += f"; back at the peak {'in' if monthly else 'on'} {fmt(recovery)}."
        elif raw["status"] == "unobservable":
            data = series[rule.series]
            gap = data.eras[data.run_end(raw["era_no"])].gap_after  # the gap that ends the run
            if gap is not None:
                description += f"; recovery not observable (no {SERIES_SPECS[rule.series].display} data "
                description += f"{_fmt_month(gap[0])} – {_fmt_month(gap[1])})."
            else:
                description += "; recovery not observable in this series."
        else:
            description += f"; not back at the peak by {_fmt_day(_ts(raw['latest']['date']))}."

        available = [key for key in SERIES_KEYS if _available(series.get(key), peak, trough)]
        cases.append(
            {
                "id": f"{rule.id_prefix}-{peak:%Y-%m}",
                "kind": rule.key,
                "name": name,
                "short_name": short,
                "name_source": name_source,
                "aka": aka,
                "region": rule.region,
                "series": {
                    "key": rule.series,
                    "source": raw["source_at_peak"],
                    "label": info.label,
                    "resolution": era.resolution,
                    "precision": era.precision,
                    "spans_splice": bool(raw["spans_splice"]),
                },
                "peak": _iso(peak),
                "trough": _iso(trough),
                "recovery": _iso(recovery),
                "recovery_status": raw["status"],
                "depth_pct": raw["depth"],
                "days_to_trough": int((trough - peak).days),
                "days_to_recovery": int((recovery - peak).days) if recovery is not None else None,
                "latest": raw["latest"],
                "lower_low": raw["lower_low"],
                "core_index": _core_index_block(core_clean, bucket, peak, trough),
                "macro_strength": _macro_block(strength_clean, coverage, state, peak, trough),
                "sky": {
                    "date": _iso(peak),
                    "precision": era.precision,
                    "available": EPHEMERIS_START <= _iso(peak) <= EPHEMERIS_END,
                },
                "series_available": available,
                "recessions": overlaps,
                "events": case_events,
                "description": description,
                "flags": {
                    "open": raw["status"] == "not_recovered",
                    "recovery_unobservable": raw["status"] == "unobservable",
                    "spans_splice": bool(raw["spans_splice"]),
                    "month_precise": monthly,
                },
            }
        )
    for number, entry in enumerate(CURATED_NAMES):
        if number not in used:
            warnings.append(f"curated name {entry.name!r} matched no case")

    # Two peaks of one kind in one month: day-level ids for those cases.
    by_id: dict[str, list[dict[str, Any]]] = {}
    for case in cases:
        by_id.setdefault(case["id"], []).append(case)
    for case_id, group in by_id.items():
        if len(group) > 1:
            for case in group:
                case["id"] = f"{case_id}-{case['peak'][8:10]}"
    # Two neutral names alike inside one kind: add months ("Apr 2013", "Apr–Jul 2013").
    by_name: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for case in cases:
        by_name.setdefault((case["kind"], case["name"]), []).append(case)
    for group in by_name.values():
        if len(group) < 2:
            continue
        for case in group:
            peak, trough = _ts(case["peak"]), _ts(case["trough"])
            years = _years_label(peak, trough)
            same_month = (peak.year, peak.month) == (trough.year, trough.month)
            months = f"{peak:%b}" if same_month else f"{peak:%b}–{trough:%b}"
            case["name"] = case["name"].replace(f"of {years}", f"of {months} {years}")
            case["short_name"] = case["short_name"].replace(years, f"{months} {years}")
    for case in cases:
        if len(case["short_name"]) > SHORT_NAME_MAX:
            warnings.append(f"{case['id']}: short name longer than {SHORT_NAME_MAX} characters")
        if len(case["description"]) > DESCRIPTION_MAX:
            warnings.append(f"{case['id']}: description longer than {DESCRIPTION_MAX} characters")

    ids = {case["id"] for case in cases}
    pairs = [{"a": a, "b": b} for a, b in PAIRS if a in ids and b in ids]
    for a, b in PAIRS:
        if a not in ids or b not in ids:
            warnings.append(f"pair {a} / {b} is not in the catalogue")
    if DEFAULT_PAIR[0] in ids and DEFAULT_PAIR[1] in ids:
        default_pair = {"a": DEFAULT_PAIR[0], "b": DEFAULT_PAIR[1]}
    else:
        warnings.append("default pair is not in the catalogue")
        default_pair = pairs[0] if pairs else None

    us = series.get("sp500")
    full = coverage[coverage >= 0.99]
    gap = us.gaps[0] if us is not None and us.gaps else None
    counts = {"total": len(cases)}
    counts.update({key: sum(1 for case in cases if case["kind"] == key) for key in KIND_RULES})
    counts.update(
        {
            "us_equity_monthly": sum(1 for c in cases if c["kind"] == "us_equity" and c["flags"]["month_precise"]),
            "us_equity_daily": sum(1 for c in cases if c["kind"] == "us_equity" and not c["flags"]["month_precise"]),
            "named": sum(1 for c in cases if c["name_source"] == "curated"),
            "open": sum(1 for c in cases if c["flags"]["open"]),
            "unobservable": sum(1 for c in cases if c["flags"]["recovery_unobservable"]),
            "lower_low": sum(1 for c in cases if c["lower_low"]),
            "month_precise": sum(1 for c in cases if c["flags"]["month_precise"]),
            "with_sky": sum(1 for c in cases if c["sky"]["available"]),
            "with_core_index": sum(1 for c in cases if c["core_index"] and c["core_index"]["at_peak"] is not None),
            "with_macro_strength": sum(
                1 for c in cases if c["macro_strength"] and c["macro_strength"]["at_peak"] is not None
            ),
        }
    )
    us_note = "; ".join(
        f"{item['label']}, {_fmt_month(_ts(item['start']))} – {_fmt_month(_ts(item['end']))}" for item in _segments(us)
    )
    notes = [
        "Every peak, low and recovery is an observation date of the case's own series.",
        f"US stocks: {us_note}. Levels compare only within one segment; aligned paths chain the segments "
        "with a zero return where they meet.",
        "NBER recessions are month-precise and assigned retrospectively; they are listed as context, not as cases.",
        "Descriptive historical research. Not a forecast and not investment advice.",
    ]
    if us is not None and any(era.family == "sp" for era in us.eras):
        notes.insert(
            2,
            "The daily S&P history leaves out Saturday sessions, and a close equal to the previous trading "
            "day's close cannot be told apart from a carried-forward day, so the earlier of the two dates is used.",
        )
    if gap is not None:
        notes.insert(2, f"No US stock data {_fmt_month(gap[0])} – {_fmt_month(gap[1])}.")

    catalogue = {
        "version": CASES_VERSION,
        "as_of": _iso(frame.index.max()),
        "data_version": meta.get("data_version"),
        "coverage": {
            "core_index_start": _iso(core_clean.index.min()) if not core_clean.empty else None,
            "macro_strength_start": _iso(strength_clean.index.min()) if not strength_clean.empty else None,
            "macro_strength_full_from": _iso(full.index.min()) if not full.empty else None,
            "ephemeris": {"start": EPHEMERIS_START, "end": EPHEMERIS_END},
            "equity_gap": None if gap is None else {"start": _iso(gap[0]), "end": _iso(gap[1])},
            "series_first_obs": {key: _iso(data.index[0]) for key, data in series.items() if data is not None},
            "series_last_obs": {key: _iso(data.index[-1]) for key, data in series.items() if data is not None},
            "sp500_index_start": SP500_INDEX_START,
            "us_equity_segments": _segments(us),
        },
        "kinds": [
            {
                "key": rule.key,
                "label": rule.label,
                "region": rule.region,
                "threshold_pct": round(rule.threshold * 100),
                "rule": _rule_text(rule, series.get(rule.series)),
            }
            for rule in KIND_RULES.values()
        ],
        "default_pair": default_pair,
        "pairs": pairs,
        "recessions": recessions,
        "counts": counts,
        "cases": cases,
        "notes": notes,
    }
    return CaseContext(
        catalogue=catalogue,
        series=series,
        cases_by_id={case["id"]: case for case in cases},
        core_index=core,
        macro_strength=strength,
        warnings=warnings,
    )


def build_case_catalogue(
    frame: pd.DataFrame,
    meta: dict[str, Any] | None,
    finance_events: Iterable[dict[str, Any]] | None,
    crypto_definitions: Iterable[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """The ``GET /cases`` payload for a loaded frame."""
    return build_context(frame, meta, finance_events, crypto_definitions).catalogue


# ---------------------------------------------------------------------------
# Aligned paths
# ---------------------------------------------------------------------------


def _sample(days: np.ndarray, monthly: np.ndarray, anchors: Iterable[int] = ()) -> list[int]:
    """Positions to keep: every point within PATH_ALL_POINTS_DAYS and every
    monthly point; the last point of each 7-day bucket to
    PATH_WEEKLY_UNTIL_DAYS, then of each 30-day bucket. ``anchors`` (the
    positions of the case's low, recovery and lower low) are kept wherever
    they fall, so a mark inside a bucket is never sampled away."""
    keep: list[int] = []
    last_bucket = None
    for i, day in enumerate(days.tolist()):
        if monthly[i] or abs(day) <= PATH_ALL_POINTS_DAYS:
            keep.append(i)
            last_bucket = None
            continue
        bucket = ("w", day // 7) if abs(day) <= PATH_WEEKLY_UNTIL_DAYS else ("m", day // 30)
        if keep and bucket == last_bucket:
            keep[-1] = i
        else:
            keep.append(i)
        last_bucket = bucket
    extra = {int(i) for i in anchors if 0 <= int(i) < len(days)}
    if extra.difference(keep):
        keep = sorted(extra.union(keep))
    return keep


def _lane(values: pd.Series, dates: pd.DatetimeIndex) -> list[float | None] | None:
    picked = values.reindex(dates).tolist()
    out = [None if value is None or not math.isfinite(value) else round(float(value), 1) + 0.0 for value in picked]
    return out if any(value is not None for value in out) else None


def _aligned_path(
    ctx: CaseContext,
    data: SeriesData,
    path_id: str,
    t0: pd.Timestamp,
    from_days: int,
    marks: Iterable[pd.Timestamp] = (),
) -> dict[str, Any]:
    """One sampled path from ``t0``. Each of ``marks`` (dates of the case's low,
    recovery and lower low) keeps the last observation on or before it: on the
    case's own series that is the mark's own day; on another series it is the
    value as of that day."""
    key = data.key
    pos, tolerance, resolution = data.base(t0)
    if pos < 0:
        raise ValueError(f"No {SERIES_SPECS[key].display} observation within {tolerance} days of {_iso(t0)}.")
    index = data.index
    lo = t0 + pd.Timedelta(days=from_days)
    hi = min(t0 + pd.Timedelta(days=PATH_UNTIL_DAYS), index[-1])
    ends = "data_end" if hi == index[-1] else "until"
    for gap_start, gap_end in data.gaps:
        if lo <= gap_end < t0:
            lo = gap_end + pd.Timedelta(days=1)
    for gap_start, _ in data.gaps:
        if t0 < gap_start <= hi:
            hi, ends = gap_start - pd.Timedelta(days=1), "series_gap"
            break
    i0 = int(index.searchsorted(lo, side="left"))
    i1 = int(index.searchsorted(hi, side="right"))
    dates = index[i0:i1]
    days = np.asarray((dates - t0).days, dtype="int64")
    anchors = [at - i0 for at in (data.position(mark) for mark in marks) if i0 <= at < i1]
    keep = _sample(days, data.monthly[i0:i1], anchors)
    base = float(data.chain[pos])
    d = [int(days[k]) for k in keep]
    v = [_round((float(data.chain[i0 + k]) / base - 1.0) * 100.0, 2) for k in keep]
    sample_dates = dates[keep]
    if 0 not in d:
        at = bisect_left(d, 0)
        d.insert(at, 0)
        v.insert(at, 0.0)
        sample_dates = sample_dates.insert(at, t0)

    splices = [
        {"d": int((index[i] - t0).days), "from": data.sources[i - 1], "to": data.sources[i]}
        for i in range(i0 + 1, i1)
        if data.families[i] != data.families[i - 1]
    ]
    names: list[str] = []
    early = np.asarray(dates < _SP500_START, dtype=bool)
    for source, is_early in zip(data.sources[i0:i1].tolist(), early.tolist()):
        info = (_SP90 if is_early else _SP500) if source in SP_SOURCES else source_info(key, source)
        if not names or names[-1] != info.index:
            names.append(info.index)
    return {
        "id": path_id,
        "series": key,
        "series_label": " → ".join(names) if names else source_info(key, data.sources[pos], t0).index,
        "resolution": resolution,
        "t0": _iso(t0),
        "base_date": _iso(index[pos]),
        "base_value": _round(data.raw[pos], 2),
        "from_days": int(from_days),
        "last_obs": _iso(index[-1]),
        "ends": ends,
        "d": d,
        "v": v,
        "ci": _lane(ctx.core_index, sample_dates),
        "ms": _lane(ctx.macro_strength, sample_dates),
        "splices": splices,
    }


def build_case_path(
    ctx: CaseContext,
    case_id: str,
    series: str = "own",
    from_days: int = 0,
    align: str = "peak",
) -> dict[str, Any]:
    """The ``GET /cases/{case_id}/path`` payload.

    Day 0 is the case peak. For ``today`` it is the highest native observation
    of the series' current era (``align=peak``) or its last observation
    (``align=latest``). The case's low, recovery and lower low (for ``today``
    with ``align=peak``, the lowest observation since the peak) are always
    points of the path. Raises UnknownCaseError (a KeyError) for an unknown id
    and ValueError for a bad parameter or a series without data near day 0.
    """
    if series not in PATH_SERIES:
        raise ValueError(f"series must be one of {', '.join(PATH_SERIES)}.")
    if from_days not in ALLOWED_FROM_DAYS:
        raise ValueError(f"from must be one of {', '.join(str(value) for value in ALLOWED_FROM_DAYS)}.")
    if align not in ALIGNMENTS:
        raise ValueError("align must be peak or latest.")
    extra: dict[str, Any] = {"align": None, "current_pct_from_peak": None, "peak_date": None}
    if case_id == TODAY_ID:
        key = "sp500" if series == "own" else series
        data = ctx.series.get(key)
        if data is None:
            raise ValueError(f"No {SERIES_SPECS[key].display} observations in the artifact.")
        era = data.eras[-1]
        values = era.obs.to_numpy(dtype="float64")
        top = float(values.max())
        top_at = int(np.nonzero(values == top)[0][-1])
        peak_at = era.obs.index[top_at]
        t0 = peak_at if align == "peak" else era.end
        # The lowest observation since the peak (the first, if equal).
        marks = [era.obs.index[top_at + int(np.argmin(values[top_at:]))]] if align == "peak" else []
        extra = {
            "align": align,
            "current_pct_from_peak": _pct(float(values[-1]), top, 1),
            "peak_date": _iso(peak_at),
        }
    else:
        case = ctx.cases_by_id.get(case_id)
        if case is None:
            raise UnknownCaseError(case_id)
        if align != "peak":
            raise ValueError("align=latest applies only to the today pseudo-case.")
        key = case["series"]["key"] if series == "own" else series
        data = ctx.series.get(key)
        t0 = _ts(case["peak"])
        if data is None:
            raise ValueError(f"No {SERIES_SPECS[key].display} observations in the artifact.")
        lower_low = case["lower_low"]["date"] if case["lower_low"] else None
        marks = [_ts(day) for day in (case["trough"], case["recovery"], lower_low) if day]
    return {**_aligned_path(ctx, data, case_id, t0, from_days, marks), **extra}


# ---------------------------------------------------------------------------
# Self-checks (run by the tests, not per request)
# ---------------------------------------------------------------------------


def validate_catalogue(ctx: CaseContext, *, require_pairs: bool = True) -> list[str]:
    """Problems with the rule-derived dates; an empty list means the catalogue holds.

    ``require_pairs`` also checks that DEFAULT_PAIR and PAIRS exist, which only
    holds on the committed artifact.
    """
    problems: list[str] = []
    cases = ctx.catalogue["cases"]
    ids = [case["id"] for case in cases]
    if len(ids) != len(set(ids)):
        problems.append("duplicate ids")
    for case in cases:
        data = ctx.series[case["series"]["key"]]
        marks = {}
        for label in ("peak", "trough", "recovery"):
            value = case.get(label)
            if value is None:
                continue
            when = _ts(value)
            if when not in data.index:
                problems.append(f"{case['id']}: {label} {value} is not an observation")
                continue
            marks[label] = int(data.index.get_loc(when))
        if "peak" not in marks or "trough" not in marks:
            continue
        p, t = marks["peak"], marks["trough"]
        segment = data.chain[p : t + 1]
        if segment.max() > data.chain[p] * (1 + 1e-12):
            problems.append(f"{case['id']}: a higher value lies between peak and trough")
        if segment.min() < data.chain[t] * (1 - 1e-12):
            problems.append(f"{case['id']}: a lower value lies between peak and trough")
        if round((data.raw[t] / data.raw[p] - 1.0) * 100.0, 1) != case["depth_pct"]:
            problems.append(f"{case['id']}: depth differs from the series")
        if "recovery" in marks:
            r = marks["recovery"]
            if data.chain[r] < data.chain[p] * (1 - 1e-12):
                problems.append(f"{case['id']}: recovery is below the peak")
            between = data.chain[t:r]
            if between.size and between.max() >= data.chain[p] * (1 - 1e-12):
                problems.append(f"{case['id']}: recovery is not the first regain of the peak")
        if len(case["description"]) > DESCRIPTION_MAX:
            problems.append(f"{case['id']}: description too long")
        if len(case["short_name"]) > SHORT_NAME_MAX:
            problems.append(f"{case['id']}: short name too long")
    if require_pairs:
        for a, b in (DEFAULT_PAIR, *PAIRS):
            if a not in ids or b not in ids:
                problems.append(f"pair {a} / {b} is not in the catalogue")
    return problems


# ---------------------------------------------------------------------------
# Runtime store
# ---------------------------------------------------------------------------


def read_frame(path: Path | str) -> pd.DataFrame:
    """The parquet columns the catalogue needs (a subset, to keep memory low)."""
    import pyarrow.parquet as pq

    names = set(pq.read_schema(path).names)
    frame = pd.read_parquet(path, columns=[column for column in FRAME_COLUMNS if column in names])
    frame.index = pd.to_datetime(frame.index, utc=True)
    return frame.sort_index()


def load_finance_events(path: Path | str) -> list[dict[str, str]]:
    """Finance events (date, name) from historical_events.json; [] when unreadable."""
    payload = _read_json(Path(path))
    items = []
    for item in payload.get("events") or []:
        if not isinstance(item, dict) or item.get("category") != "Finance":
            continue
        when, name = item.get("date"), item.get("name")
        if isinstance(when, str) and len(when) >= 10 and name:
            items.append({"date": when[:10], "name": str(name)})
    return sorted(items, key=lambda item: item["date"])


def _file_stamp(path: Path) -> tuple[int, int] | None:
    try:
        stat = path.stat()
    except OSError:
        return None
    return stat.st_mtime_ns, stat.st_size


class CaseStore:
    """Loads the artifact like MacroRegimeService (mtime-checked) and caches
    the catalogue plus an LRU of serialized paths until the parquet, the meta
    file or the events file changes. Only the columns the catalogue needs are
    read."""

    def __init__(
        self,
        artifact_path: Path | str = DEFAULT_ARTIFACT,
        meta_path: Path | str = DEFAULT_META,
        events_path: Path | str = DEFAULT_EVENTS,
        *,
        path_cache_size: int = PATH_CACHE_SIZE,
        path_cache_bytes: int = PATH_CACHE_BYTES,
    ) -> None:
        self.artifact_path = Path(artifact_path)
        self.meta_path = Path(meta_path)
        self.events_path = Path(events_path)
        self.path_cache_size = path_cache_size
        self.path_cache_bytes = path_cache_bytes
        self._lock = threading.RLock()
        self._context: CaseContext | None = None
        self._stamp: tuple | None = None
        self._paths: OrderedDict[tuple, bytes] = OrderedDict()
        self._paths_bytes = 0

    def context(self) -> CaseContext:
        with self._lock:
            if not self.artifact_path.exists():
                raise FileNotFoundError(
                    f"Macro regime artifact not found at {self.artifact_path}. "
                    "Run: python -m scripts.flows.macro_ingestion"
                )
            stamp = (_file_stamp(self.artifact_path), _file_stamp(self.meta_path), _file_stamp(self.events_path))
            if self._context is None or stamp != self._stamp:
                started = time.perf_counter()
                context = build_context(
                    read_frame(self.artifact_path),
                    _read_json(self.meta_path),
                    load_finance_events(self.events_path),
                    milestone_definitions(),
                )
                context.build_seconds = round(time.perf_counter() - started, 3)
                for message in context.warnings:
                    logger.warning("regime cases: %s", message)
                self._context, self._stamp = context, stamp
                self._paths.clear()
                self._paths_bytes = 0
            return self._context

    def cases(self) -> dict[str, Any]:
        return self.context().catalogue

    def case_path_json(
        self,
        case_id: str,
        series: str = "own",
        from_days: int = 0,
        align: str = "peak",
    ) -> bytes:
        """The path payload as compact UTF-8 JSON (what the route serves), from
        an LRU bounded by ``path_cache_size`` entries and ``path_cache_bytes``;
        the newest entry is always kept."""
        with self._lock:
            context = self.context()
            key = (case_id, series, int(from_days), align)
            cached = self._paths.get(key)
            if cached is not None:
                self._paths.move_to_end(key)
                return cached
            payload = build_case_path(context, case_id, series=series, from_days=int(from_days), align=align)
            body = json.dumps(payload, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode("utf-8")
            self._paths[key] = body
            self._paths_bytes += len(body)
            while len(self._paths) > 1 and (
                len(self._paths) > self.path_cache_size or self._paths_bytes > self.path_cache_bytes
            ):
                _, evicted = self._paths.popitem(last=False)
                self._paths_bytes -= len(evicted)
            return body

    def case_path(
        self,
        case_id: str,
        series: str = "own",
        from_days: int = 0,
        align: str = "peak",
    ) -> dict[str, Any]:
        """The path payload as a dict, decoded from the cached JSON."""
        return json.loads(self.case_path_json(case_id, series, from_days, align))
