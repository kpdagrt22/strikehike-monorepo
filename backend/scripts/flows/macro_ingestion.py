"""FRED macro ingestion for the Regime Intelligence engine.

Phase 1 of the Regime Intelligence build. The script pulls a 70+ series macro
universe from FRED, merges daily/monthly/quarterly observations onto a single
forward-filled daily calendar, aligns NBER recession windows from ``USREC`` and
writes ``data/processed/macro_regime_history.parquet`` for the read API.

Transport
---------
``--source auto`` (default) uses the official FRED API when ``FRED_API_KEY`` is
present and falls back to FRED's public ``fredgraph.csv`` endpoint otherwise.
``--source api`` requires the key; ``--source csv`` never uses it. The key is
read from ``backend/.env`` or ``backend/../.env`` and is never logged.

Run
---
    cd backend
    python -m scripts.flows.macro_ingestion --check-key
    python -m scripts.flows.macro_ingestion

The output is the Phase 1 artifact, not a live endpoint. The API in
``regime/router.py`` reads the parquet and serves ``/api/v1/regime/macro-history``.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import random
import re
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Iterable, Mapping, Sequence

import numpy as np
import pandas as pd
import requests
from dotenv import load_dotenv
from loguru import logger

BACKEND_DIR = Path(__file__).resolve().parents[2]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from regime.analytics import (  # noqa: E402
    CORE_INDEX_NOTE,
    SP500_DAILY_COLUMN,
    SP500_DAILY_SOURCE,
    STRENGTH_VERSION,
    STRENGTH_WEIGHTS,
    annotate_nber,
    build_sp500_proxy,
    calculate_core_index,
    calculate_macro_strength_components,
    core_index_metadata,
    nber_episodes,
)
from regime.crypto_milestones import (  # noqa: E402
    write_crypto_milestones_artifact,
)

REPO_DIR = BACKEND_DIR.parent
DEFAULT_CACHE_DIR = BACKEND_DIR / "data" / "raw" / "fred"
DEFAULT_OUTPUT_DIR = BACKEND_DIR / "data" / "processed"
FRED_API_BASE = "https://api.stlouisfed.org/fred"
FRED_CSV_URL = "https://fred.stlouisfed.org/graph/fredgraph.csv"
USER_AGENT = "strikehike-regime-intelligence/phase1 (+https://strikehike.com)"
PIPELINE_VERSION = "phase12-v2"
WORLD_BANK_COMMODITY_PAGE = "https://www.worldbank.org/en/research/commodity-markets"
WORLD_BANK_CMO_FALLBACK = (
    "https://thedocs.worldbank.org/en/doc/"
    "74e8be41ceb20fa0da750cda2f6b9e4e-0050012026/related/"
    "CMO-Historical-Data-Monthly.xlsx"
)
GOLD_SERIES_ID = "GOLD_LBMA"
GOLD_SOURCE = "WORLD_BANK_LBMA_GOLD"
BITCOIN_SERIES_ID = "BTCUSD"
BITCOIN_SOURCE = "BLOCKCHAIN_COM_MARKET_PRICE"
BITCOIN_URL = (
    "https://api.blockchain.info/charts/market-price"
    "?timespan=all&format=json&sampled=false"
)
NIFTY_SERIES_ID = "NIFTY50"
NIFTY_SOURCE = "YAHOO_FINANCE_NSEI"
NIFTY_URL = "https://query1.finance.yahoo.com/v8/finance/chart/%5ENSEI"
SP500_DAILY_SERIES_ID = SP500_DAILY_COLUMN
SP500_DAILY_URL = "https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC"
# ^GSPC starts on 1927-12-30, before the Unix epoch, so period1=0 (the Nifty
# request) would cut it at 1970.
SP500_DAILY_PERIOD1 = int(pd.Timestamp("1927-01-01", tz="UTC").timestamp())
# S&P closes are published to two decimals; a larger Yahoo-vs-FRED gap is a
# vendor print error, not float noise (see reconcile_sp500_daily).
SP500_RECONCILE_TOLERANCE = 0.005
# Shape the ^GSPC history must have before an artifact is written (see
# check_sp500_daily_shape). Yahoo's first close is 1927-12-30, it held 24,823
# closes on 2026-10-27, and its longest gap is the 12-day 1933 bank holiday.
SP500_DAILY_LATEST_FIRST_CLOSE = "1928-01-03"
SP500_DAILY_MIN_CLOSES = 24_000
SP500_DAILY_MAX_GAP_DAYS = 15
# Official S&P 500 closes (S&P Dow Jones Indices, via FRED SP500) for the dates
# where Yahoo's ^GSPC close was off by more than half a cent when FRED's
# ten-year window covered them (checked 2026-10-28 against 2016-10-27 to
# 2026-10-23). They are committed here so a correction does not revert once
# its date leaves FRED's rolling window. date: (Yahoo print, official close).
SP500_OFFICIAL_CORRECTIONS: dict[str, tuple[float, float]] = {
    "2018-11-29": (2737.80, 2737.76),
    "2019-08-12": (2882.70, 2883.75),
    "2020-05-11": (2930.19, 2930.32),
    "2020-10-02": (3348.42, 3348.44),
    "2020-10-05": (3408.60, 3408.63),
    "2020-10-06": (3360.97, 3360.95),
    "2020-10-07": (3419.44, 3419.45),
    "2020-10-09": (3477.14, 3477.13),
    "2021-08-11": (4442.41, 4447.70),
}
# Isolated bad prints in Yahoo's ^GSPC history. Each is a one-session move of
# 3.5-10%, five to nine times the typical daily move around it, that fully
# reverses at the next close, and each print is one digit away from a value in
# line with its neighbours. No market event explains them: an 8-10% day, as
# three of these would be, ranks among the largest in US index history, and
# these dates are not among those on record. The print is dropped, so the
# daily frame carries the previous close forward; no replacement value is
# invented. A print is dropped only while Yahoo still serves the recorded
# value. This is a reviewed list, not a spike filter: real reversals
# (1929-10-29, 1931-10-05, 2011-08-09/10, March 2020) must stay.
# date: (Yahoo print, reason).
SP500_BAD_PRINTS: dict[str, tuple[float, str]] = {
    "1935-04-16": (
        8.22,
        "-10.0% close, about 7x the typical daily move around it, fully "
        "reversed at the next close (+9.6%); 8.22 is one digit from 9.22, "
        "1.0% above the previous close",
    ),
    "1935-05-16": (
        9.15,
        "-6.8% close, about 6x the typical daily move around it, fully "
        "reversed at the next close (+9.4%); 9.15 is one digit from 9.85 or "
        "9.95, both between the neighbours",
    ),
    "1935-08-16": (
        10.62,
        "-8.0% close, about 7x the typical daily move around it, fully "
        "reversed at the next close (+7.5%); 10.62 is one digit from 11.62, "
        "0.7% above the previous close",
    ),
    "1936-09-16": (
        15.00,
        "-5.8% close, about 8x the typical daily move around it, fully "
        "reversed at the next close (+5.8%); 15.00 is one digit from 15.90, "
        "between the neighbours",
    ),
    "1938-10-10": (
        13.91,
        "+8.2% close, about 5x the typical daily move around it, fully "
        "reversed at the next close (-7.7%); 13.91 is one digit from 12.91, "
        "0.5% above both neighbours",
    ),
    "1961-04-17": (
        68.68,
        "+3.5% close, about 9x the typical daily move around it, fully "
        "reversed at the next close (-3.6%); 68.68 is one digit from 66.68, "
        "0.5% above the previous close",
    ),
}
HY_OAS_ARCHIVE_URL = (
    "https://gist.githubusercontent.com/jcopeland23451/"
    "75cf1a099fffbfb0d400a8af60072ee3/raw"
)
CRYPTO_MILESTONES_FILENAME = "crypto_milestones.json"
PATTERNS_V2_SKILL_FILENAME = "patterns_v2_skill.json"


# ---------------------------------------------------------------------------
# Errors and configuration
# ---------------------------------------------------------------------------


class MacroConfigError(RuntimeError):
    """Missing key, bad CLI combination, or an unusable cache."""


class FredAPIError(RuntimeError):
    """FRED returned an unexpected response or exhausted retries."""


class FredAuthError(FredAPIError):
    """The FRED API key is missing or rejected."""


class SeriesShapeError(FredAPIError):
    """A required input is missing or truncated; the artifact is not written."""


def load_environment() -> None:
    """Load backend/.env and repo-root .env without overriding real env vars."""
    for path in (BACKEND_DIR / ".env", REPO_DIR / ".env"):
        if path.exists():
            load_dotenv(path, override=False)


def get_api_key() -> str | None:
    load_environment()
    key = os.getenv("FRED_API_KEY", "").strip()
    return key or None


_SECRET_QUERY_RE = re.compile(r"(?i)(api_key=)[^&\s'\"<>)]+")


def redact_secrets(text: object) -> str:
    """Hide credential query values (FRED's api_key) in text that may be logged or published.

    requests exceptions quote the full request URL, which carries the key as a
    query parameter; warnings end up in the committed meta.json and the API.
    """
    return _SECRET_QUERY_RE.sub(r"\1REDACTED", str(text))


def _configure_logging(verbose: bool = False) -> None:
    logger.remove()
    logger.add(
        sys.stderr,
        level="DEBUG" if verbose else "INFO",
        format="<green>{time:HH:mm:ss}</green> | <level>{level: <7}</level> | {message}",
    )


# ---------------------------------------------------------------------------
# Series universe
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class SeriesSpec:
    series_id: str
    title: str
    frequency: str
    units: str
    category: str
    role: str = "context"


def _spec(
    series_id: str,
    title: str,
    frequency: str,
    units: str,
    category: str,
    role: str = "context",
) -> SeriesSpec:
    return SeriesSpec(series_id, title, frequency, units, category, role)


# Phase 1 universe: 75 series. The requested M1333MACD156NNBR is not a valid
# FRED ID (HTTP 404), so the long-run equity proxy uses the valid NBER/Cowles
# series before the daily Yahoo ^GSPC history begins (see build_sp500_proxy).
# Add a SeriesSpec to grow toward the 60+ target.
SERIES_REGISTRY: tuple[SeriesSpec, ...] = (
    # Core requested series.
    _spec("USREC", "NBER based recession indicator", "M", "Index (0/1)", "cycle", "core"),
    _spec("T10Y2Y", "10-year minus 2-year Treasury spread", "D", "Percent", "rates", "core"),
    _spec("FEDFUNDS", "Effective federal funds rate", "M", "Percent", "rates", "core"),
    _spec("CPIAUCSL", "CPI for all urban consumers", "M", "Index 1982-84=100", "inflation", "core"),
    _spec("PPIACO", "PPI for all commodities", "M", "Index 1982=100", "inflation", "core"),
    # Long-run equity proxy inputs (see build_sp500_proxy). Dow-Jones and Nasdaq
    # stay as raw context columns; they are not S&P levels and are not spliced.
    _spec("M1125AUSM343NNBR", "Cowles/S&P common stock price index", "M", "Index 1935-39=100", "markets", "proxy"),
    _spec("M1109BUSM293NNBR", "Dow-Jones industrial stock price index", "M", "USD per share", "markets", "context"),
    _spec("SP500", "S&P 500", "D", "Index", "markets", "proxy"),
    _spec("NASDAQCOM", "Nasdaq composite", "D", "Index", "markets", "context"),
    # Rates and credit.
    _spec("DGS10", "10-year Treasury constant maturity", "D", "Percent", "rates"),
    _spec("DGS2", "2-year Treasury constant maturity", "D", "Percent", "rates"),
    _spec("DGS5", "5-year Treasury constant maturity", "D", "Percent", "rates"),
    _spec("DGS30", "30-year Treasury constant maturity", "D", "Percent", "rates"),
    _spec("DGS3MO", "3-month Treasury constant maturity", "D", "Percent", "rates"),
    _spec("T10Y3M", "10-year minus 3-month Treasury spread", "D", "Percent", "rates"),
    _spec("DFF", "Effective federal funds rate (daily)", "D", "Percent", "rates"),
    _spec("BAA10Y", "Moody's Baa minus 10-year Treasury", "D", "Percent", "rates"),
    _spec(
        "BAMLH0A0HYM2",
        "ICE BofA US High Yield Index option-adjusted spread",
        "D",
        "Percent",
        "credit",
        "target",
    ),
    _spec("MORTGAGE30US", "30-year fixed mortgage rate", "W", "Percent", "rates"),
    _spec("T10YIE", "10-year breakeven inflation rate", "D", "Percent", "rates"),
    _spec("T5YIE", "5-year breakeven inflation rate", "D", "Percent", "rates"),
    _spec("BAA", "Moody's Baa corporate bond yield", "M", "Percent", "rates"),
    _spec("AAA", "Moody's Aaa corporate bond yield", "M", "Percent", "rates"),
    _spec("TB3MS", "3-month Treasury bill rate", "M", "Percent", "rates"),
    _spec("GS10", "10-year Treasury constant maturity (monthly)", "M", "Percent", "rates"),
    # Inflation.
    _spec("CPILFESL", "Core CPI", "M", "Index 1982-84=100", "inflation"),
    _spec("PPIIDC", "PPI industrial commodities", "M", "Index 1982=100", "inflation"),
    _spec("PPICMM", "PPI construction materials", "M", "Index 1982=100", "inflation"),
    _spec("PCEPI", "PCE price index", "M", "Index 2017=100", "inflation"),
    _spec("PCEPILFE", "Core PCE price index", "M", "Index 2017=100", "inflation"),
    _spec("GDPDEF", "GDP deflator", "Q", "Index 2017=100", "inflation"),
    _spec("MICH", "Michigan 1-year inflation expectation", "M", "Percent", "inflation"),
    _spec("EXPINF1YR", "1-year inflation expectation", "M", "Percent", "inflation"),
    # Labour.
    _spec("UNRATE", "Unemployment rate", "M", "Percent", "labor"),
    _spec("PAYEMS", "Total nonfarm payrolls", "M", "Thousands", "labor"),
    _spec("ICSA", "Initial jobless claims", "W", "Persons", "labor"),
    _spec("CCSA", "Continuing jobless claims", "W", "Persons", "labor"),
    _spec("CIVPART", "Civilian labour force participation", "M", "Percent", "labor"),
    _spec("EMRATIO", "Employment-population ratio", "M", "Percent", "labor"),
    _spec("AWHMAN", "Average weekly hours, manufacturing", "M", "Hours", "labor"),
    _spec("JTSJOL", "Job openings", "M", "Thousands", "labor"),
    _spec("MANEMP", "Manufacturing employment", "M", "Thousands", "labor"),
    # Growth and activity.
    _spec("INDPRO", "Industrial production index", "M", "Index 2017=100", "growth"),
    _spec("IPMAN", "Manufacturing industrial production", "M", "Index 2017=100", "growth"),
    _spec("IPMANSICS", "Manufacturing production (SIC)", "M", "Index 2017=100", "growth"),
    _spec("IPCONGD", "Consumer goods production", "M", "Index 2017=100", "growth"),
    _spec("TCU", "Capacity utilisation", "M", "Percent", "growth"),
    _spec("GDPC1", "Real GDP", "Q", "Billions of chained 2017 dollars", "growth"),
    _spec("PCE", "Personal consumption expenditures", "M", "Billions of dollars", "growth"),
    _spec("RSAFS", "Retail sales", "M", "Millions of dollars", "growth"),
    _spec("UMCSENT", "Michigan consumer sentiment", "M", "Index 1966=100", "growth"),
    _spec("CFNAI", "Chicago Fed national activity index", "M", "Index", "growth"),
    # Housing.
    _spec("HOUST", "Housing starts", "M", "Thousands", "housing"),
    _spec("PERMIT", "Building permits", "M", "Thousands", "housing"),
    _spec("CSUSHPINSA", "Case-Shiller national home price index", "M", "Index Jan 2000=100", "housing"),
    _spec("MSPUS", "Median sales price of houses", "Q", "USD", "housing"),
    # Money, liquidity and credit.
    _spec("M2SL", "M2 money stock", "M", "Billions of dollars", "liquidity"),
    _spec("M1SL", "M1 money stock", "M", "Billions of dollars", "liquidity"),
    _spec("BOGMBASE", "Monetary base", "M", "Billions of dollars", "liquidity"),
    _spec("WALCL", "Federal Reserve total assets", "W", "Millions of dollars", "liquidity"),
    _spec("RRPONTSYD", "Overnight reverse repo", "D", "Billions of dollars", "liquidity"),
    _spec("BUSLOANS", "Commercial and industrial loans", "M", "Billions of dollars", "liquidity"),
    _spec("CONSUMER", "Consumer credit", "M", "Billions of dollars", "liquidity"),
    _spec("TOTALSL", "Total consumer credit", "M", "Billions of dollars", "liquidity"),
    _spec("NFCI", "Chicago Fed national financial conditions", "W", "Index", "liquidity"),
    _spec("STLFSI4", "St. Louis Fed financial stress index", "W", "Index", "liquidity"),
    _spec("VIXCLS", "CBOE volatility index", "D", "Index", "liquidity"),
    _spec("DCOILWTICO", "WTI crude oil spot", "D", "USD per barrel", "liquidity"),
    _spec("DTWEXBGS", "Broad dollar index", "D", "Index Jan 2006=100", "liquidity"),
    _spec("DEXUSEU", "USD per euro", "D", "USD per euro", "liquidity"),
    _spec("DEXJPUS", "JPY per USD", "D", "JPY per USD", "liquidity"),
    # Trade and fiscal.
    _spec("BOPGSTB", "Trade balance in goods and services", "M", "Millions of dollars", "trade"),
    _spec("IR", "Import price index", "M", "Index 2000=100", "trade"),
    _spec("IQ", "Export price index", "M", "Index 2000=100", "trade"),
    _spec("GFDEGDQ188S", "Federal debt as percent of GDP", "Q", "Percent of GDP", "fiscal"),
    _spec("GFDEBTN", "Federal debt, total public debt", "Q", "Millions of dollars", "fiscal"),
)

SPECS_BY_ID: dict[str, SeriesSpec] = {spec.series_id: spec for spec in SERIES_REGISTRY}


def select_specs(series_ids: Sequence[str] | str | None) -> list[SeriesSpec]:
    if not series_ids:
        return list(SERIES_REGISTRY)
    if isinstance(series_ids, str):
        ids = [part.strip().upper() for part in series_ids.split(",") if part.strip()]
    else:
        ids = [str(part).strip().upper() for part in series_ids if str(part).strip()]
    ids = list(dict.fromkeys(ids))
    unknown = [series_id for series_id in ids if series_id not in SPECS_BY_ID]
    if unknown:
        raise MacroConfigError(f"Unknown series IDs: {', '.join(unknown)}")
    return [SPECS_BY_ID[series_id] for series_id in ids]


# ---------------------------------------------------------------------------
# FRED transports
# ---------------------------------------------------------------------------


def _today_iso() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def _date_str(value: Any) -> str:
    return pd.Timestamp(value).date().isoformat()


def _to_utc_timestamp(value: Any) -> pd.Timestamp:
    timestamp = pd.Timestamp(value)
    if timestamp.tzinfo is None:
        timestamp = timestamp.tz_localize("UTC")
    else:
        timestamp = timestamp.tz_convert("UTC")
    return timestamp.normalize()


def parse_fred_observations(payload: dict[str, Any], series_id: str) -> pd.Series:
    dates: list[str] = []
    values: list[float] = []
    for observation in payload.get("observations", []) or []:
        raw = observation.get("value")
        if raw is None or str(raw).strip() in {"", "."}:
            continue
        try:
            value = float(raw)
        except (TypeError, ValueError):
            continue
        if not np.isfinite(value):
            continue
        dates.append(str(observation.get("date")))
        values.append(value)

    if not dates:
        return pd.Series(dtype="float64", name=series_id)

    index = pd.to_datetime(pd.Index(dates), utc=True, errors="coerce")
    series = pd.Series(values, index=index, name=series_id, dtype="float64")
    series = series[series.index.notna()].dropna().sort_index()
    return series[~series.index.duplicated(keep="last")]


class FredClient:
    """Official FRED API client using a raw HTTP GET (no fredapi dependency)."""

    def __init__(
        self,
        api_key: str,
        *,
        base_url: str = FRED_API_BASE,
        timeout: float = 30.0,
        max_retries: int = 5,
        delay: float = 0.6,
    ) -> None:
        if not api_key:
            raise FredAuthError("FRED_API_KEY is empty")
        self._api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.max_retries = max_retries
        self.delay = max(0.0, delay)
        self._session = requests.Session()
        self._session.headers.update(
            {"User-Agent": USER_AGENT, "Accept": "application/json"}
        )

    def close(self) -> None:
        self._session.close()

    def _sleep_backoff(self, attempt: int, retry_after: str | None = None) -> None:
        if retry_after:
            try:
                seconds = min(float(retry_after), 60.0)
            except ValueError:
                seconds = 0.0
        else:
            seconds = 0.0
        if seconds <= 0:
            seconds = min(2.0 ** attempt, 30.0) + random.uniform(0.0, 0.5)
        time.sleep(seconds)

    def _request(self, path: str, params: dict[str, Any]) -> dict[str, Any]:
        url = f"{self.base_url}/{path.lstrip('/')}"
        payload = dict(params)
        payload["api_key"] = self._api_key
        payload["file_type"] = "json"

        last_error: Exception | None = None
        for attempt in range(self.max_retries + 1):
            try:
                response = self._session.get(url, params=payload, timeout=self.timeout)
            except requests.RequestException as exc:
                last_error = exc
                if attempt >= self.max_retries:
                    break
                logger.warning(
                    "FRED network error for {} ({}); retrying",
                    path,
                    type(exc).__name__,
                )
                self._sleep_backoff(attempt)
                continue

            if response.status_code == 200:
                try:
                    data = response.json()
                except ValueError as exc:
                    raise FredAPIError("FRED returned a non-JSON response") from exc
                time.sleep(self.delay)
                return data

            message = redact_secrets(_fred_error_message(response))
            if response.status_code in {429, 500, 502, 503, 504}:
                if attempt < self.max_retries:
                    logger.warning(
                        "FRED {} for {}; retrying", response.status_code, path
                    )
                    self._sleep_backoff(attempt, response.headers.get("Retry-After"))
                    continue
            if response.status_code in {400, 401, 403} and "api_key" in message.lower():
                raise FredAuthError(
                    "FRED rejected the API key. Check FRED_API_KEY in backend/.env."
                )
            raise FredAPIError(f"FRED HTTP {response.status_code}: {message}")

        raise FredAPIError(
            "FRED request failed after retries: " + redact_secrets(last_error)
        )

    def fetch_series(
        self,
        series_id: str,
        *,
        start: Any | None = None,
        end: Any | None = None,
    ) -> pd.Series:
        params: dict[str, Any] = {"series_id": series_id, "sort_order": "asc"}
        if start is not None:
            params["observation_start"] = _date_str(start)
        if end is not None:
            params["observation_end"] = _date_str(end)
        payload = self._request("/series/observations", params)
        return parse_fred_observations(payload, series_id)

    def series_info(self, series_id: str) -> dict[str, Any]:
        payload = self._request("/series", {"series_id": series_id})
        items = payload.get("seriess") or []
        if not items:
            raise FredAPIError(f"FRED has no metadata for {series_id}")
        return items[0]


class FredCsvClient:
    """Keyless fallback using FRED's public fredgraph.csv endpoint."""

    def __init__(
        self,
        *,
        timeout: float = 30.0,
        max_retries: int = 5,
        delay: float = 0.6,
    ) -> None:
        self.timeout = timeout
        self.max_retries = max_retries
        self.delay = max(0.0, delay)
        self._session = requests.Session()
        self._session.headers.update({"User-Agent": USER_AGENT})

    def close(self) -> None:
        self._session.close()

    def fetch_series(
        self,
        series_id: str,
        *,
        start: Any | None = None,
        end: Any | None = None,
    ) -> pd.Series:
        params = {
            "id": series_id,
            "cosd": _date_str(start) if start is not None else "1776-07-04",
            "coed": _date_str(end) if end is not None else _today_iso(),
        }
        last_error: Exception | None = None
        for attempt in range(self.max_retries + 1):
            try:
                response = self._session.get(
                    FRED_CSV_URL, params=params, timeout=self.timeout
                )
            except requests.RequestException as exc:
                last_error = exc
                if attempt >= self.max_retries:
                    break
                time.sleep(min(2.0 ** attempt, 30.0) + random.uniform(0.0, 0.5))
                continue

            if response.status_code == 200:
                time.sleep(self.delay)
                return _parse_fred_csv(response.text, series_id)
            if response.status_code == 404:
                raise FredAPIError(f"{series_id}: not found on FRED")
            if response.status_code in {429, 500, 502, 503, 504}:
                if attempt < self.max_retries:
                    time.sleep(min(2.0 ** attempt, 30.0) + random.uniform(0.0, 0.5))
                    continue
            raise FredAPIError(
                f"{series_id}: FRED CSV HTTP {response.status_code}"
            )

        raise FredAPIError(f"{series_id}: CSV request failed after retries: {last_error}")


def _fred_error_message(response: requests.Response) -> str:
    try:
        payload = response.json()
    except ValueError:
        return (response.text or response.reason or "")[:300]
    message = payload.get("error_message") if isinstance(payload, dict) else None
    return str(message or payload)[:500]


def _parse_fred_csv(text: str, series_id: str) -> pd.Series:
    frame = pd.read_csv(io.StringIO(text))
    if frame.empty or frame.shape[1] < 2:
        raise FredAPIError(f"{series_id}: empty FRED CSV response")
    date_column, value_column = frame.columns[0], frame.columns[1]
    dates = pd.to_datetime(frame[date_column], utc=True, errors="coerce")
    values = pd.to_numeric(frame[value_column], errors="coerce")
    series = pd.Series(
        values.to_numpy(), index=dates, name=series_id, dtype="float64"
    )
    series = series[series.index.notna() & series.notna()].sort_index()
    series = series[~series.index.duplicated(keep="last")]
    if series.empty:
        raise FredAPIError(f"{series_id}: no numeric observations")
    return series


def make_client(
    source: str,
    api_key: str | None,
    *,
    delay: float,
) -> tuple[FredClient | FredCsvClient, str]:
    source = source.lower()
    if source == "api":
        if not api_key:
            raise MacroConfigError(
                "FRED_API_KEY is not set. Add it to backend/.env or use --source csv."
            )
        return FredClient(api_key, delay=delay), "api"
    if source == "csv":
        return FredCsvClient(delay=delay), "csv"
    if source == "auto":
        if api_key:
            logger.info("FRED transport: official API (key present)")
            return FredClient(api_key, delay=delay), "api"
        logger.warning(
            "FRED_API_KEY is not set; using FRED's public CSV endpoint. "
            "Add the key to backend/.env for the official API path."
        )
        return FredCsvClient(delay=delay), "csv"
    raise MacroConfigError(f"Unknown source: {source}")


# ---------------------------------------------------------------------------
# Cache
# ---------------------------------------------------------------------------


def _read_json(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return payload if isinstance(payload, dict) else {}


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        json.dumps(payload, indent=2, sort_keys=True, default=str),
        encoding="utf-8",
    )
    temporary.replace(path)


def _load_cached_series(path: Path, series_id: str) -> pd.Series | None:
    if not path.exists():
        return None
    try:
        raw = pd.read_csv(path)
    except (OSError, ValueError):
        return None
    if not {"date", "value"}.issubset(raw.columns):
        return None
    dates = pd.to_datetime(raw["date"], utc=True, errors="coerce")
    values = pd.to_numeric(raw["value"], errors="coerce")
    series = pd.Series(
        values.to_numpy(), index=dates, name=series_id, dtype="float64"
    )
    series = series[series.index.notna() & series.notna()].sort_index()
    series = series[~series.index.duplicated(keep="last")]
    return series if not series.empty else None


def _save_cached_series(path: Path, series: pd.Series) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    series.rename("value").to_frame().to_csv(
        temporary, index_label="date", date_format="%Y-%m-%d"
    )
    temporary.replace(path)


def _cache_age_hours(manifest: dict[str, Any], series_id: str) -> float | None:
    entry = manifest.get("series", {}).get(series_id, {})
    fetched_at = entry.get("fetched_at")
    if not fetched_at:
        return None
    try:
        timestamp = pd.Timestamp(fetched_at)
    except (TypeError, ValueError):
        return None
    if timestamp.tzinfo is None:
        timestamp = timestamp.tz_localize("UTC")
    else:
        timestamp = timestamp.tz_convert("UTC")
    return (pd.Timestamp.now(tz="UTC") - timestamp).total_seconds() / 3600.0


def fetch_universe(
    client: FredClient | FredCsvClient | None,
    specs: Sequence[SeriesSpec],
    *,
    cache_dir: Path,
    refresh: bool,
    offline: bool,
    max_age_hours: float,
    start: Any | None,
    end: Any | None,
) -> tuple[dict[str, pd.Series], dict[str, Any], list[str]]:
    cache_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = cache_dir / "_manifest.json"
    manifest = _read_json(manifest_path)
    manifest.setdefault("series", {})

    series_map: dict[str, pd.Series] = {}
    warnings: list[str] = []
    total = len(specs)

    for position, spec in enumerate(specs, start=1):
        series_id = spec.series_id
        cache_path = cache_dir / f"{series_id}.csv"
        cached = _load_cached_series(cache_path, series_id)
        age_hours = _cache_age_hours(manifest, series_id)
        use_cache = (
            cached is not None
            and not refresh
            and (offline or (age_hours is not None and age_hours <= max_age_hours))
        )

        if use_cache:
            series = cached
            logger.debug("[{}/{}] cache {}", position, total, series_id)
        elif offline:
            raise MacroConfigError(
                f"Offline mode: no usable cache for {series_id} in {cache_dir}"
            )
        else:
            try:
                assert client is not None
                logger.info("[{}/{}] fetching {}", position, total, series_id)
                series = client.fetch_series(series_id, start=start, end=end)
                if series.empty:
                    raise FredAPIError("no observations returned")
                _save_cached_series(cache_path, series)
                manifest["series"][series_id] = {
                    "fetched_at": datetime.now(timezone.utc).isoformat(),
                    "observations": int(series.size),
                    "first_observation": series.index.min().date().isoformat(),
                    "last_observation": series.index.max().date().isoformat(),
                }
                _write_json(manifest_path, manifest)
            except FredAuthError:
                raise
            except Exception as exc:
                message = (
                    f"{series_id}: fetch failed ({type(exc).__name__}: {redact_secrets(exc)})"
                )
                if cached is not None:
                    logger.warning("{}; using stale cache", message)
                    warnings.append(message + "; stale cache used")
                    series = cached
                else:
                    logger.error("{}; skipped", message)
                    warnings.append(message + "; skipped")
                    continue

        if start is not None:
            series = series.loc[_to_utc_timestamp(start) :]
        if end is not None:
            series = series.loc[: _to_utc_timestamp(end)]
        if series.empty:
            warnings.append(f"{series_id}: no rows in requested range; skipped")
            continue

        series_map[series_id] = series
        logger.info(
            "[{}/{}] {} {} {} -> {} ({} obs)",
            position,
            total,
            series_id,
            spec.frequency,
            series.index.min().date(),
            series.index.max().date(),
            len(series),
        )

    _write_json(manifest_path, manifest)
    if not series_map:
        raise FredAPIError("No FRED series could be loaded; artifact not written")
    return series_map, manifest, warnings


# ---------------------------------------------------------------------------
# Supplemental London Bullion gold target
# ---------------------------------------------------------------------------


def _world_bank_monthly_url() -> str:
    """Resolve the current World Bank Pink Sheet historical XLSX URL."""
    try:
        response = requests.get(
            WORLD_BANK_COMMODITY_PAGE,
            headers={"User-Agent": USER_AGENT},
            timeout=60,
        )
        response.raise_for_status()
        urls = re.findall(
            r"https://thedocs\.worldbank\.org/[^\"' ]+"
            r"CMO-Historical-Data-Monthly\.xlsx",
            response.text,
        )
        if urls:
            return urls[0]
    except requests.RequestException as exc:
        logger.warning("World Bank page unavailable ({}); using fallback URL", exc)
    return WORLD_BANK_CMO_FALLBACK


def _parse_world_bank_gold(content: bytes) -> pd.Series:
    """Extract the London gold benchmark from the World Bank Pink Sheet."""
    workbook = pd.ExcelFile(io.BytesIO(content))
    if "Monthly Prices" not in workbook.sheet_names:
        raise ValueError("World Bank file has no 'Monthly Prices' sheet")
    sheet = workbook.parse("Monthly Prices", header=None)
    if sheet.shape[0] < 7 or sheet.shape[1] < 2:
        raise ValueError("World Bank gold sheet is unexpectedly short")

    headers = sheet.iloc[4]
    gold_columns = [
        column
        for column, label in headers.items()
        if str(label).strip().lower() == "gold"
    ]
    if not gold_columns:
        raise ValueError("World Bank file has no Gold column")

    gold_column = gold_columns[0]
    raw = sheet.iloc[6:, [0, gold_column]].copy()
    raw.columns = ["month", "value"]
    months = pd.to_datetime(
        raw["month"].astype(str).str.replace("M", "-", regex=False),
        format="%Y-%m",
        utc=True,
        errors="coerce",
    )
    values = pd.to_numeric(raw["value"], errors="coerce")
    series = pd.Series(
        values.to_numpy(), index=months, name=GOLD_SERIES_ID, dtype="float64"
    )
    series = series[series.index.notna() & series.notna()].sort_index()
    series = series[~series.index.duplicated(keep="last")]
    if series.empty:
        raise ValueError("World Bank file has no numeric gold observations")
    return series


def fetch_gold_series(
    cache_dir: Path,
    *,
    refresh: bool,
    offline: bool,
    max_age_hours: float = 24.0 * 7.0,
    timeout: float = 90.0,
) -> pd.Series | None:
    """Fetch/cache the World Bank London gold benchmark as a monthly series."""
    cache_dir.mkdir(parents=True, exist_ok=True)
    cache_path = cache_dir / f"{GOLD_SERIES_ID}.csv"
    cached = _load_cached_series(cache_path, GOLD_SERIES_ID)

    cache_age = None
    if cache_path.exists():
        cache_age = (
            pd.Timestamp.now(tz="UTC").timestamp() - cache_path.stat().st_mtime
        ) / 3600.0
    if cached is not None and not refresh and (
        offline or (cache_age is not None and cache_age <= max_age_hours)
    ):
        logger.info(
            "Using cached {} {} -> {} ({} obs)",
            GOLD_SERIES_ID,
            cached.index.min().date(),
            cached.index.max().date(),
            len(cached),
        )
        return cached

    if offline:
        if cached is not None:
            return cached
        raise MacroConfigError(
            f"Offline mode: no cached {GOLD_SERIES_ID} in {cache_dir}"
        )

    url = _world_bank_monthly_url()
    try:
        response = requests.get(
            url,
            headers={"User-Agent": USER_AGENT},
            timeout=timeout,
        )
        response.raise_for_status()
        series = _parse_world_bank_gold(response.content)
        _save_cached_series(cache_path, series)
        logger.info(
            "Fetched {} from World Bank {} -> {} ({} obs)",
            GOLD_SERIES_ID,
            series.index.min().date(),
            series.index.max().date(),
            len(series),
        )
        return series
    except (requests.RequestException, ValueError, OSError) as exc:
        if cached is not None:
            logger.warning(
                "{} fetch failed ({}); using stale cache {} -> {}",
                GOLD_SERIES_ID,
                exc,
                cached.index.min().date(),
                cached.index.max().date(),
            )
            return cached
        raise FredAPIError(
            f"{GOLD_SERIES_ID}: World Bank fetch failed ({exc})"
        ) from exc


def _parse_blockchain_bitcoin(content: bytes) -> pd.Series:
    """Parse Blockchain.com's market-price JSON into a daily BTC series."""
    payload = json.loads(content)
    values = payload.get("values") if isinstance(payload, dict) else None
    if not isinstance(values, list) or not values:
        raise ValueError("Blockchain.com returned no Bitcoin price values")

    timestamps = pd.to_datetime(
        [item.get("x") for item in values],
        unit="s",
        utc=True,
        errors="coerce",
    )
    prices = pd.to_numeric(
        [item.get("y") for item in values], errors="coerce"
    )
    series = pd.Series(
        prices, index=timestamps, name=BITCOIN_SERIES_ID, dtype="float64"
    )
    series = series[series.index.notna() & series.notna() & (series > 0)]
    series = series[series.index >= pd.Timestamp("2010-01-01", tz="UTC")]
    series = series.sort_index()
    series = series[~series.index.duplicated(keep="last")]
    if series.empty:
        raise ValueError("Blockchain.com returned no positive Bitcoin prices")
    return series


def fetch_bitcoin_series(
    cache_dir: Path,
    *,
    refresh: bool,
    offline: bool,
    max_age_hours: float = 24.0,
    timeout: float = 60.0,
) -> pd.Series | None:
    """Fetch/cache daily Bitcoin market price history from Blockchain.com."""
    cache_dir.mkdir(parents=True, exist_ok=True)
    cache_path = cache_dir / f"{BITCOIN_SERIES_ID}.csv"
    cached = _load_cached_series(cache_path, BITCOIN_SERIES_ID)

    cache_age = None
    if cache_path.exists():
        cache_age = (
            pd.Timestamp.now(tz="UTC").timestamp() - cache_path.stat().st_mtime
        ) / 3600.0
    if cached is not None and not refresh and (
        offline or (cache_age is not None and cache_age <= max_age_hours)
    ):
        logger.info(
            "Using cached {} {} -> {} ({} obs)",
            BITCOIN_SERIES_ID,
            cached.index.min().date(),
            cached.index.max().date(),
            len(cached),
        )
        return cached

    if offline:
        if cached is not None:
            return cached
        raise MacroConfigError(
            f"Offline mode: no cached {BITCOIN_SERIES_ID} in {cache_dir}"
        )

    try:
        response = requests.get(
            BITCOIN_URL,
            headers={"User-Agent": USER_AGENT},
            timeout=timeout,
        )
        response.raise_for_status()
        series = _parse_blockchain_bitcoin(response.content)
        _save_cached_series(cache_path, series)
        logger.info(
            "Fetched {} from Blockchain.com {} -> {} ({} obs)",
            BITCOIN_SERIES_ID,
            series.index.min().date(),
            series.index.max().date(),
            len(series),
        )
        return series
    except (requests.RequestException, ValueError, OSError) as exc:
        if cached is not None:
            logger.warning(
                "{} fetch failed ({}); using stale cache {} -> {}",
                BITCOIN_SERIES_ID,
                exc,
                cached.index.min().date(),
                cached.index.max().date(),
            )
            return cached
        raise FredAPIError(
            f"{BITCOIN_SERIES_ID}: Blockchain.com fetch failed ({exc})"
        ) from exc


def _unfinished_session_mask(
    timestamps: Sequence[Any],
    meta: Any,
    now: pd.Timestamp,
) -> np.ndarray:
    """Flag the bars of a regular session that has not closed yet.

    During a session Yahoo's daily chart ends with a live bar priced at the
    latest trade. ``meta.currentTradingPeriod.regular`` gives the current (or
    next) session's start and end. Until that end has passed, bars dated on the
    session's exchange-local day or later are provisional. Bars of earlier
    sessions are final, so a fetch before the open keeps yesterday's close.
    """
    stamps = pd.to_numeric(pd.Series(list(timestamps)), errors="coerce").to_numpy(
        dtype="float64"
    )
    keep_all = np.zeros(len(stamps), dtype=bool)
    if not isinstance(meta, dict):
        return keep_all
    current = meta.get("currentTradingPeriod")
    period = current.get("regular") if isinstance(current, dict) else None
    if not isinstance(period, dict):
        return keep_all
    try:
        start = float(period["start"])
        end = float(period["end"])
        offset = float(period.get("gmtoffset", meta.get("gmtoffset", 0)) or 0)
    except (KeyError, TypeError, ValueError):
        return keep_all
    if now.timestamp() >= end:
        return keep_all
    session_day = np.floor((start + offset) / 86400.0)
    with np.errstate(invalid="ignore"):
        return np.floor((stamps + offset) / 86400.0) >= session_day


def _parse_yahoo_chart(
    content: bytes,
    series_id: str,
    label: str,
    *,
    now: Any | None = None,
) -> pd.Series:
    """Parse Yahoo Finance's daily chart payload into a close-price series.

    The bar of a session still in progress is dropped (see
    ``_unfinished_session_mask``), so an intraday price is never stored as a
    close. ``now`` defaults to the current UTC time.
    """
    payload = json.loads(content)
    chart = payload.get("chart") if isinstance(payload, dict) else None
    results = chart.get("result") if isinstance(chart, dict) else None
    if not isinstance(results, list) or not results:
        raise ValueError(f"Yahoo Finance returned no {label} result")
    result = results[0]
    timestamps = result.get("timestamp")
    quotes = (result.get("indicators") or {}).get("quote") or []
    closes = quotes[0].get("close") if quotes else None
    if not isinstance(timestamps, list) or not isinstance(closes, list):
        raise ValueError(f"Yahoo Finance returned no {label} prices")
    index = pd.to_datetime(timestamps, unit="s", utc=True, errors="coerce")
    prices = pd.to_numeric(closes, errors="coerce")
    series = pd.Series(
        prices,
        index=index.normalize(),
        name=series_id,
        dtype="float64",
    )
    current = pd.Timestamp.now(tz="UTC") if now is None else pd.Timestamp(now)
    if current.tzinfo is None:
        current = current.tz_localize("UTC")
    unfinished = _unfinished_session_mask(timestamps, result.get("meta"), current)
    if unfinished.any():
        logger.info(
            "{}: dropping {} bar(s) from {} (session not closed yet)",
            series_id,
            int(unfinished.sum()),
            series.index[unfinished].min().date(),
        )
        series = series[~unfinished]
    series = series[series.index.notna() & series.notna() & (series > 0)]
    series = series.sort_index()
    series = series[~series.index.duplicated(keep="last")]
    if series.empty:
        raise ValueError(f"Yahoo Finance returned no positive {label} prices")
    return series


def _parse_yahoo_nifty(content: bytes, *, now: Any | None = None) -> pd.Series:
    """Parse Yahoo Finance's daily chart payload into a Nifty 50 series."""
    return _parse_yahoo_chart(content, NIFTY_SERIES_ID, "Nifty 50", now=now)


def _parse_yahoo_sp500(content: bytes, *, now: Any | None = None) -> pd.Series:
    """Parse Yahoo Finance's daily ^GSPC chart payload into an S&P series."""
    return _parse_yahoo_chart(content, SP500_DAILY_SERIES_ID, "S&P 500", now=now)


def _fetch_yahoo_chart_series(
    cache_dir: Path,
    *,
    series_id: str,
    url: str,
    period1: int,
    parser: Callable[[bytes], pd.Series],
    refresh: bool,
    offline: bool,
    max_age_hours: float,
    timeout: float,
    warnings: list[str] | None = None,
) -> pd.Series | None:
    """Fetch/cache a daily close history from Yahoo Finance's chart API.

    A failed fetch falls back to the stale cache and, like ``fetch_universe``,
    records that in ``warnings`` so it reaches the artifact metadata.
    """
    cache_dir.mkdir(parents=True, exist_ok=True)
    cache_path = cache_dir / f"{series_id}.csv"
    cached = _load_cached_series(cache_path, series_id)
    cache_age = None
    if cache_path.exists():
        cache_age = (
            pd.Timestamp.now(tz="UTC").timestamp() - cache_path.stat().st_mtime
        ) / 3600.0
    if cached is not None and not refresh and (
        offline or (cache_age is not None and cache_age <= max_age_hours)
    ):
        logger.info(
            "Using cached {} {} -> {} ({} obs)",
            series_id,
            cached.index.min().date(),
            cached.index.max().date(),
            len(cached),
        )
        return cached
    if offline:
        if cached is not None:
            return cached
        raise MacroConfigError(
            f"Offline mode: no cached {series_id} in {cache_dir}"
        )
    try:
        response = requests.get(
            url,
            params={
                "period1": period1,
                "period2": int(pd.Timestamp.now(tz="UTC").timestamp()),
                "interval": "1d",
                "events": "div%2Csplits",
            },
            headers={"User-Agent": USER_AGENT},
            timeout=timeout,
        )
        response.raise_for_status()
        series = parser(response.content)
        _save_cached_series(cache_path, series)
        logger.info(
            "Fetched {} from Yahoo Finance {} -> {} ({} obs)",
            series_id,
            series.index.min().date(),
            series.index.max().date(),
            len(series),
        )
        return series
    except (requests.RequestException, ValueError, OSError) as exc:
        if cached is not None:
            message = (
                f"{series_id}: Yahoo Finance fetch failed "
                f"({type(exc).__name__}: {exc}); stale cache used "
                f"(last close {cached.index.max().date().isoformat()})"
            )
            logger.warning("{}", message)
            if warnings is not None:
                warnings.append(message)
            return cached
        raise FredAPIError(
            f"{series_id}: Yahoo Finance fetch failed ({exc})"
        ) from exc


def fetch_nifty_series(
    cache_dir: Path,
    *,
    refresh: bool,
    offline: bool,
    max_age_hours: float = 24.0,
    timeout: float = 60.0,
    warnings: list[str] | None = None,
) -> pd.Series | None:
    """Fetch/cache daily Nifty 50 history from Yahoo Finance."""
    return _fetch_yahoo_chart_series(
        cache_dir,
        series_id=NIFTY_SERIES_ID,
        url=NIFTY_URL,
        period1=0,
        parser=_parse_yahoo_nifty,
        refresh=refresh,
        offline=offline,
        max_age_hours=max_age_hours,
        timeout=timeout,
        warnings=warnings,
    )


def fetch_sp500_daily_series(
    cache_dir: Path,
    *,
    refresh: bool,
    offline: bool,
    max_age_hours: float = 24.0,
    timeout: float = 60.0,
    warnings: list[str] | None = None,
) -> pd.Series | None:
    """Fetch/cache daily S&P composite history (^GSPC) from Yahoo Finance.

    The history begins on 1927-12-30. Before 1957-03-04 the index is the
    S&P 90, the S&P 500's predecessor; Saturday sessions before 1952 are absent.
    """
    return _fetch_yahoo_chart_series(
        cache_dir,
        series_id=SP500_DAILY_SERIES_ID,
        url=SP500_DAILY_URL,
        period1=SP500_DAILY_PERIOD1,
        parser=_parse_yahoo_sp500,
        refresh=refresh,
        offline=offline,
        max_age_hours=max_age_hours,
        timeout=timeout,
        warnings=warnings,
    )


def check_sp500_daily_shape(daily: pd.Series | None) -> None:
    """Refuse a missing or truncated ^GSPC history.

    Without it the S&P series would fall back to Cowles (to 1956) plus FRED's
    ten-year window, leaving a sixty-year hole and no Core Index (which reads
    daily closes only) before 2017, so the artifact must not be written.
    """
    name = SP500_DAILY_SERIES_ID
    if daily is None or daily.empty:
        raise SeriesShapeError(
            f"{name}: no daily S&P history loaded; the artifact is not written"
        )
    first = daily.index.min()
    if first > pd.Timestamp(SP500_DAILY_LATEST_FIRST_CLOSE, tz="UTC"):
        raise SeriesShapeError(
            f"{name}: daily S&P history starts {first.date().isoformat()}, after "
            f"{SP500_DAILY_LATEST_FIRST_CLOSE}; it looks truncated, so the "
            "artifact is not written"
        )
    if len(daily) < SP500_DAILY_MIN_CLOSES:
        raise SeriesShapeError(
            f"{name}: only {len(daily)} daily closes (expected at least "
            f"{SP500_DAILY_MIN_CLOSES}); it looks truncated, so the artifact "
            "is not written"
        )
    gaps = daily.index.to_series().diff().dt.days
    widest = gaps.max()
    if pd.notna(widest) and widest > SP500_DAILY_MAX_GAP_DAYS:
        hole = gaps.idxmax()
        raise SeriesShapeError(
            f"{name}: {int(widest)}-day hole in the daily S&P history before "
            f"{hole.date().isoformat()} (longest real closure is 12 days); "
            "the artifact is not written"
        )


def reconcile_sp500_daily(
    daily: pd.Series,
    official: pd.Series | None,
    *,
    tolerance: float = SP500_RECONCILE_TOLERANCE,
    committed: Mapping[str, tuple[float, float]] | None = None,
    warnings: list[str] | None = None,
) -> tuple[pd.Series, dict[str, Any]]:
    """Use official S&P 500 closes where the Yahoo ^GSPC close is wrong.

    1. The committed corrections (``SP500_OFFICIAL_CORRECTIONS`` by default)
       apply on every build, whatever FRED's rolling window covers today. An
       entry is applied only while Yahoo still serves the recorded print.
    2. On the dates FRED's SP500 (S&P Dow Jones Indices, ten-year window)
       covers, any remaining Yahoo close more than ``tolerance`` away from the
       official close is a vendor print error and is replaced. Such a date is
       new, so a warning asks for it to be committed.

    Every replacement is returned so the metadata can list it.
    """
    committed = SP500_OFFICIAL_CORRECTIONS if committed is None else committed
    name = SP500_DAILY_SERIES_ID
    report: dict[str, Any] = {
        "reference": "SP500",
        "tolerance": tolerance,
        "overlap_days": 0,
        "committed_corrections": len(committed),
        "replaced": {},
    }
    if daily.empty:
        return daily, report

    def warn(message: str) -> None:
        logger.warning("{}", message)
        if warnings is not None:
            warnings.append(message)

    has_official = official is not None and not official.empty
    window = official.index if has_official else pd.DatetimeIndex([], tz="UTC")
    reconciled = daily.copy()
    replaced: dict[str, dict[str, Any]] = {}
    for day_text, (vendor_close, official_close) in sorted(committed.items()):
        day = pd.Timestamp(day_text, tz="UTC")
        if day not in reconciled.index:
            warn(
                f"{name}: committed correction for {day_text} not applied; "
                "Yahoo's history no longer has that date"
            )
            continue
        value = float(reconciled.loc[day])
        if abs(value - official_close) <= tolerance:
            continue  # Yahoo now serves the official close.
        if abs(value - vendor_close) > tolerance:
            warn(
                f"{name}: committed correction for {day_text} not applied; "
                f"Yahoo now serves {value:.2f}, not the recorded {vendor_close:.2f}"
            )
            continue
        reconciled.loc[day] = official_close
        replaced[day_text] = {
            "yahoo": round(value, 4),
            "fred": official_close,
            "committed": True,
            "in_fred_window": bool(day in window),
        }

    if has_official:
        common = reconciled.index.intersection(official.index)
        report["overlap_days"] = int(len(common))
        gap = (reconciled.loc[common] - official.loc[common]).abs()
        bad = gap.index[gap > tolerance]
        for day in bad:
            day_text = day.date().isoformat()
            vendor = float(daily.loc[day])
            fred = float(official.loc[day])
            replaced[day_text] = {
                "yahoo": round(vendor, 4),
                "fred": round(fred, 4),
                "committed": False,
                "in_fred_window": True,
            }
            if day_text in committed:
                warn(
                    f"{name}: FRED's official close for {day_text} ({fred:.2f}) "
                    "differs from the committed correction "
                    f"({committed[day_text][1]:.2f}); FRED's close is used. "
                    "Update SP500_OFFICIAL_CORRECTIONS"
                )
            else:
                warn(
                    f"{name}: Yahoo close for {day_text} ({vendor:.2f}) differs "
                    f"from FRED's official close ({fred:.2f}); replaced in this "
                    "build. Add it to SP500_OFFICIAL_CORRECTIONS so the fix "
                    "survives FRED's rolling ten-year window"
                )
        if len(bad):
            reconciled.loc[bad] = official.loc[bad].to_numpy()

    report["replaced"] = dict(sorted(replaced.items()))
    return reconciled, report


def drop_sp500_bad_prints(
    daily: pd.Series,
    *,
    bad_prints: Mapping[str, tuple[float, str]] | None = None,
    tolerance: float = SP500_RECONCILE_TOLERANCE,
    warnings: list[str] | None = None,
) -> tuple[pd.Series, list[dict[str, Any]]]:
    """Drop the reviewed vendor bad prints (``SP500_BAD_PRINTS`` by default).

    A dropped close leaves no observation on that date, so the daily frame
    carries the previous close forward; no value is invented. A print is
    dropped only while Yahoo still serves the recorded value. Each entry is
    returned with its neighbours and reason for the metadata.
    """
    bad_prints = SP500_BAD_PRINTS if bad_prints is None else bad_prints
    name = SP500_DAILY_SERIES_ID
    entries: list[dict[str, Any]] = []
    drop: list[pd.Timestamp] = []
    for day_text, (vendor_close, reason) in sorted(bad_prints.items()):
        day = pd.Timestamp(day_text, tz="UTC")
        entry: dict[str, Any] = {
            "date": day_text,
            "vendor_close": vendor_close,
            "previous": None,
            "next": None,
            "reason": reason,
        }
        if day not in daily.index:
            entry["status"] = "date absent"
            message = f"{name}: listed bad print {day_text} is no longer in Yahoo's history"
        else:
            position = int(daily.index.get_loc(day))
            for key, step in (("previous", -1), ("next", 1)):
                neighbour = position + step
                if 0 <= neighbour < len(daily):
                    entry[key] = {
                        "date": daily.index[neighbour].date().isoformat(),
                        "close": round(float(daily.iloc[neighbour]), 2),
                    }
            value = float(daily.iloc[position])
            if abs(value - vendor_close) <= tolerance:
                entry["status"] = "dropped"
                drop.append(day)
                message = ""
            else:
                entry["status"] = "kept: vendor value changed"
                entry["vendor_close_now"] = round(value, 4)
                message = (
                    f"{name}: listed bad print {day_text} not dropped; Yahoo now "
                    f"serves {value:.2f}, not the recorded {vendor_close:.2f}"
                )
        if message:
            logger.warning("{}", message)
            if warnings is not None:
                warnings.append(message)
        entries.append(entry)
    cleaned = daily.drop(index=drop) if drop else daily.copy()
    return cleaned, entries


def append_official_sp500_tail(
    daily: pd.Series,
    official: pd.Series | None,
    *,
    warnings: list[str] | None = None,
) -> tuple[pd.Series, dict[str, Any]]:
    """Extend a stale Yahoo history with FRED's later official closes.

    Normally Yahoo is a day or more ahead of FRED and nothing happens. When the
    Yahoo fetch failed and an older cache was used, FRED's newer official
    closes are appended (and listed) instead of the old close being carried
    forward, and a warning is recorded.
    """
    if official is None or official.empty or daily.empty:
        return daily, {}
    last = daily.index.max()
    tail = official.loc[official.index > last].dropna()
    if tail.empty:
        return daily, {}
    extended = pd.concat([daily, tail.rename(daily.name)]).sort_index()
    report = {
        "reference": "SP500",
        "after_last_yahoo_close": last.date().isoformat(),
        "closes": {
            day.date().isoformat(): round(float(value), 4)
            for day, value in tail.items()
        },
    }
    message = (
        f"{SP500_DAILY_SERIES_ID}: Yahoo's history ends {last.date().isoformat()} "
        f"but FRED's official S&P 500 has {len(tail)} later close(s) "
        f"({tail.index.min().date().isoformat()} to "
        f"{tail.index.max().date().isoformat()}); appended, see "
        "meta.proxy.official_tail"
    )
    logger.warning("{}", message)
    if warnings is not None:
        warnings.append(message)
    return extended, report


def find_flat_runs(daily: pd.Series, *, min_sessions: int = 3) -> list[dict[str, Any]]:
    """Runs of ``min_sessions`` or more identical consecutive closes (cents)."""
    values = daily.round(2).to_numpy()
    if not len(values):
        return []
    change = np.r_[True, values[1:] != values[:-1]]
    starts = np.flatnonzero(change)
    ends = np.r_[starts[1:], len(values)] - 1
    runs = []
    for start, end in zip(starts, ends):
        sessions = int(end - start + 1)
        if sessions >= min_sessions:
            runs.append(
                {
                    "start": daily.index[start].date().isoformat(),
                    "end": daily.index[end].date().isoformat(),
                    "sessions": sessions,
                    "close": float(values[start]),
                }
            )
    return runs


def prepare_sp500_daily(
    daily: pd.Series | None,
    official: pd.Series | None,
    *,
    warnings: list[str] | None = None,
) -> tuple[pd.Series, dict[str, Any]]:
    """Check, correct and document the ^GSPC history before it is merged.

    Raises ``SeriesShapeError`` (nothing is written) for a missing or
    truncated history; otherwise applies the official corrections, drops the
    reviewed bad prints, appends FRED's later official closes when Yahoo is
    stale and lists runs of identical closes, returning a report for the
    metadata.
    """
    check_sp500_daily_shape(daily)
    assert daily is not None
    series, reconciliation = reconcile_sp500_daily(
        daily, official, warnings=warnings
    )
    series, bad_prints = drop_sp500_bad_prints(series, warnings=warnings)
    series, official_tail = append_official_sp500_tail(
        series, official, warnings=warnings
    )
    report = {
        "first_close": daily.index.min().date().isoformat(),
        "last_yahoo_close": daily.index.max().date().isoformat(),
        "reconciliation": reconciliation,
        "bad_prints": bad_prints,
        "official_tail": official_tail,
        "flat_runs": find_flat_runs(series),
    }
    return series, report


def _parse_high_yield_archive(content: bytes) -> pd.Series:
    """Parse a full-history BAMLH0A0HYM2 archive CSV (date,value rows)."""
    text = content.decode("utf-8-sig", errors="replace")
    frame = pd.read_csv(io.StringIO(text), header=None)
    if frame.empty or frame.shape[1] < 2:
        raise ValueError("High-yield archive returned no columns")
    if not pd.api.types.is_numeric_dtype(frame.iloc[:, 1]):
        frame = frame.iloc[1:]
    dates = pd.to_datetime(frame.iloc[:, 0], errors="coerce", utc=True)
    values = pd.to_numeric(frame.iloc[:, 1], errors="coerce")
    series = pd.Series(
        values.to_numpy(),
        index=dates,
        name="BAMLH0A0HYM2",
        dtype="float64",
    )
    series = series[series.index.notna() & series.notna()]
    series = series.sort_index()
    series = series[~series.index.duplicated(keep="last")]
    if series.empty:
        raise ValueError("High-yield archive returned no numeric observations")
    return series


def ensure_high_yield_history(
    series_map: dict[str, pd.Series],
    cache_dir: Path,
    *,
    refresh: bool,
    offline: bool,
) -> pd.Series | None:
    """Backfill the full 1996+ HY OAS history after FRED's 3-year window.

    FRED's public CSV endpoint currently exposes only a rolling three-year
    window of ICE BofA series. The official API still serves the full history
    when FRED_API_KEY is present. When it is not, merge FRED's recent values
    with a public archive of the same series and persist the merged cache.
    """
    existing = series_map.get("BAMLH0A0HYM2")
    if existing is not None:
        existing = pd.to_numeric(existing, errors="coerce").dropna()
    if (
        existing is not None
        and not existing.empty
        and existing.index.min() <= pd.Timestamp("2000-01-01", tz="UTC")
        and len(existing) >= 4_000
    ):
        return existing

    cache_dir.mkdir(parents=True, exist_ok=True)
    archive_path = cache_dir / "BAMLH0A0HYM2.archive.csv"
    archive = _load_cached_series(archive_path, "BAMLH0A0HYM2")

    if archive is not None and not refresh:
        logger.info(
            "Using cached full-history HY OAS archive {} -> {} ({} obs)",
            archive.index.min().date(),
            archive.index.max().date(),
            len(archive),
        )
    elif offline:
        if archive is None:
            logger.warning(
                "Offline mode: FRED's HY OAS window is only three years and "
                "no full-history archive cache exists"
            )
            return existing
    else:
        try:
            response = requests.get(
                HY_OAS_ARCHIVE_URL,
                headers={"User-Agent": USER_AGENT},
                timeout=60,
            )
            response.raise_for_status()
            archive = _parse_high_yield_archive(response.content)
            _save_cached_series(archive_path, archive)
            logger.info(
                "Backfilled full-history HY OAS archive {} -> {} ({} obs)",
                archive.index.min().date(),
                archive.index.max().date(),
                len(archive),
            )
        except (requests.RequestException, ValueError, OSError) as exc:
            logger.warning(
                "Full-history HY OAS archive fetch failed ({}); "
                "FRED's three-year window will be used",
                exc,
            )
            return existing

    if archive is None or archive.empty:
        return existing

    pieces = [archive.rename("BAMLH0A0HYM2")]
    if existing is not None and not existing.empty:
        pieces.append(existing.rename("BAMLH0A0HYM2"))
    merged = pd.concat(pieces).sort_index()
    merged = merged[~merged.index.duplicated(keep="last")]
    merged = merged[merged.index >= archive.index.min()]
    merged.name = "BAMLH0A0HYM2"
    _save_cached_series(cache_dir / "BAMLH0A0HYM2.csv", merged)
    series_map["BAMLH0A0HYM2"] = merged
    return merged


# ---------------------------------------------------------------------------
# Frame assembly
# ---------------------------------------------------------------------------


def build_macro_frame(
    series_map: dict[str, pd.Series],
    *,
    start: Any | None = None,
    end: Any | None = None,
) -> pd.DataFrame:
    """Merge native-frequency series onto a daily calendar and forward-fill.

    The daily calendar is built from the earliest observation (or the requested
    start), then every column is forward-filled. No back-fill is performed, so
    a series that begins later remains null before its first observation.
    """
    if not series_map:
        raise ValueError("series_map is empty")

    merged = pd.concat(series_map, axis=1, sort=True).sort_index()
    merged = merged[~merged.index.duplicated(keep="last")]
    data_start = merged.index.min()
    data_end = merged.index.max()

    start_timestamp = (
        _to_utc_timestamp(start) if start is not None else data_start
    )
    end_timestamp = _to_utc_timestamp(end) if end is not None else data_end
    if end_timestamp > data_end:
        logger.warning(
            "Requested end {} is beyond the latest observation {}; clamping",
            end_timestamp.date(),
            data_end.date(),
        )
        end_timestamp = data_end
    if start_timestamp > end_timestamp:
        raise ValueError("start must be earlier than end")

    full_start = min(start_timestamp, data_start)
    daily_index = pd.date_range(full_start, end_timestamp, freq="D", tz="UTC")
    frame = merged.reindex(daily_index).ffill()
    frame = frame.loc[start_timestamp:end_timestamp]
    frame.index.name = "date"
    return frame


def build_raw_daily_frame(
    series_map: dict[str, pd.Series],
    index: pd.DatetimeIndex,
) -> pd.DataFrame:
    """Native-frequency values reindexed to the daily calendar, without ffill."""
    if not series_map:
        return pd.DataFrame(index=index)
    merged = pd.concat(series_map, axis=1, sort=True).sort_index()
    merged = merged[~merged.index.duplicated(keep="last")]
    return merged.reindex(index)


def build_asset_targets(frame: pd.DataFrame) -> pd.DataFrame:
    """Serialize the S&P, gold, bond, dollar, Bitcoin and Nifty targets."""
    out = frame.copy()

    if "GOLD_LBMA" in out.columns:
        out["gold_proxy"] = pd.to_numeric(
            out["GOLD_LBMA"], errors="coerce"
        )
        out["gold_proxy_source"] = pd.Series(
            GOLD_SOURCE, index=out.index, dtype="string"
        ).where(out["gold_proxy"].notna())
    else:
        out["gold_proxy"] = np.nan
        out["gold_proxy_source"] = pd.Series(pd.NA, index=out.index, dtype="string")

    if "BTCUSD" in out.columns:
        out["btc_proxy"] = pd.to_numeric(
            out["BTCUSD"], errors="coerce"
        )
        out["btc_proxy_source"] = pd.Series(
            BITCOIN_SOURCE, index=out.index, dtype="string"
        ).where(out["btc_proxy"].notna())
    else:
        out["btc_proxy"] = np.nan
        out["btc_proxy_source"] = pd.Series(
            pd.NA, index=out.index, dtype="string"
        )

    if "NIFTY50" in out.columns:
        out["nifty_proxy"] = pd.to_numeric(
            out["NIFTY50"], errors="coerce"
        )
        out["nifty_proxy_source"] = pd.Series(
            NIFTY_SOURCE, index=out.index, dtype="string"
        ).where(out["nifty_proxy"].notna())
    else:
        out["nifty_proxy"] = np.nan
        out["nifty_proxy_source"] = pd.Series(
            pd.NA, index=out.index, dtype="string"
        )

    if "DTWEXBGS" in out.columns:
        out["dxy_proxy"] = pd.to_numeric(
            out["DTWEXBGS"], errors="coerce"
        )
        out["dxy_proxy_source"] = pd.Series(
            "DTWEXBGS", index=out.index, dtype="string"
        ).where(out["dxy_proxy"].notna())
    else:
        out["dxy_proxy"] = np.nan
        out["dxy_proxy_source"] = pd.Series(pd.NA, index=out.index, dtype="string")

    if "DGS10" in out.columns:
        yield_series = (
            pd.to_numeric(out["DGS10"], errors="coerce") / 100.0
        )
        first_valid = yield_series.first_valid_index()
        if first_valid is not None:
            previous = yield_series.shift(1)
            # 7.5-year duration proxy: coupon carry minus duration * dy.
            daily_return = (
                previous / 252.0 - 7.5 * (yield_series - previous)
            )
            daily_return = daily_return.where(yield_series.notna(), np.nan)
            bond_index = (1.0 + daily_return.fillna(0.0)).cumprod()
            base = bond_index.loc[first_valid]
            if base and np.isfinite(base):
                bond_index = bond_index / base * 100.0
            bond_index = bond_index.where(bond_index.index >= first_valid)
            out["bond_proxy"] = bond_index
            out["bond_proxy_source"] = pd.Series(
                "UST10Y_TOTAL_RETURN_PROXY",
                index=out.index,
                dtype="string",
            ).where(out["bond_proxy"].notna())
        else:
            out["bond_proxy"] = np.nan
            out["bond_proxy_source"] = pd.Series(
                pd.NA, index=out.index, dtype="string"
            )
    else:
        out["bond_proxy"] = np.nan
        out["bond_proxy_source"] = pd.Series(pd.NA, index=out.index, dtype="string")

    return out


def _write_parquet(frame: pd.DataFrame, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    frame.to_parquet(temporary, engine="pyarrow", compression="snappy", index=True)
    temporary.replace(path)


# ---------------------------------------------------------------------------
# Metadata and run orchestration
# ---------------------------------------------------------------------------


def _series_metadata(
    series_map: dict[str, pd.Series],
    specs: Sequence[SeriesSpec],
) -> dict[str, dict[str, Any]]:
    metadata: dict[str, dict[str, Any]] = {}
    for spec in specs:
        series = series_map.get(spec.series_id)
        if series is None or series.empty:
            continue
        first = series.index.min()
        last = series.index.max()
        metadata[spec.series_id] = {
            "title": spec.title,
            "frequency": spec.frequency,
            "units": spec.units,
            "category": spec.category,
            "role": spec.role,
            "observations": int(series.size),
            "first_observation": first.date().isoformat(),
            "last_observation": last.date().isoformat(),
            "coverage_years": round((last - first).days / 365.25, 1),
            "source_url": f"https://fred.stlouisfed.org/series/{spec.series_id}",
        }
    return metadata


def _proxy_metadata(frame: pd.DataFrame) -> list[dict[str, Any]]:
    if "sp500_proxy_source" not in frame.columns:
        return []
    labeled = frame["sp500_proxy_source"].dropna()
    if labeled.empty:
        return []

    runs = labeled.ne(labeled.shift()).fillna(True).astype("int64").cumsum()
    sources: list[dict[str, Any]] = []
    for _, run in labeled.groupby(runs):
        subset = frame.loc[run.index, "sp500_proxy"].dropna()
        if subset.empty:
            continue
        sources.append(
            {
                "source": str(run.iloc[0]),
                "start": run.index.min().date().isoformat(),
                "end": run.index.max().date().isoformat(),
                "observations": int(run.size),
            }
        )
    sources.sort(key=lambda item: item["start"])
    return sources


def _asset_metadata(frame: pd.DataFrame) -> dict[str, dict[str, Any]]:
    """Describe the selectable target series serialized in the artifact."""
    definitions = (
        (
            "sp500",
            "S&P 500 — S&P 90 before 1957, Cowles index before 1928",
            "sp500_proxy",
            "sp500_proxy_source",
            "",
            "Index points from 1927-12-30; Cowles 1935-39=100 before "
            "(spliced, rebased by consumer)",
        ),
        (
            "gold",
            "Gold — London bullion",
            "gold_proxy",
            "gold_proxy_source",
            "gold_",
            "$/troy oz",
        ),
        (
            "bonds",
            "US Treasury bonds",
            "bond_proxy",
            "bond_proxy_source",
            "bond_",
            "Index (10y UST total-return proxy)",
        ),
        (
            "bitcoin",
            "Bitcoin",
            "btc_proxy",
            "btc_proxy_source",
            "btc_",
            "USD",
        ),
        (
            "nifty",
            "Nifty 50 — India",
            "nifty_proxy",
            "nifty_proxy_source",
            "nifty_",
            "Index",
        ),
        (
            "dxy",
            "US Dollar — broad trade-weighted",
            "dxy_proxy",
            "dxy_proxy_source",
            "dxy_",
            "Index (Jan 2006=100)",
        ),
    )
    assets: dict[str, dict[str, Any]] = {}
    for key, label, value_field, source_field, prefix, units in definitions:
        if value_field not in frame.columns:
            continue
        values = frame[value_field].dropna()
        if values.empty:
            continue
        sources = (
            frame[source_field].dropna().astype(str)
            if source_field in frame.columns
            else pd.Series(dtype="string")
        )
        assets[key] = {
            "label": label,
            "value_field": value_field,
            "source_field": source_field,
            "volatility_field": f"{prefix}volatility_1y",
            "drawdown_field": f"{prefix}drawdown_1y",
            "percentile_field": f"{prefix}1y_volatility_percentile",
            "units": units,
            "source": str(sources.iloc[0]) if len(sources) else None,
            "first_observation": values.index.min().date().isoformat(),
            "last_observation": values.index.max().date().isoformat(),
            "observations": int(values.size),
        }
    return assets


def _sp500_warm_up(frame: pd.DataFrame) -> dict[str, Any] | None:
    """Where the S&P rolling windows are empty after the daily-segment start.

    The volatility, drawdown and percentile windows restart at a source
    boundary, so the first months of the ^GSPC segment carry no values.
    """
    if "sp500_proxy_source" not in frame.columns:
        return None
    daily = frame["sp500_proxy_source"].astype("string").eq(SP500_DAILY_SOURCE)
    daily_dates = frame.index[daily.fillna(False).to_numpy(dtype=bool)]
    if not len(daily_dates):
        return None
    start = daily_dates.min()
    warm_up: dict[str, Any] = {"segment_start": start.date().isoformat()}
    for field in ("volatility_1y", "drawdown_1y", "1y_volatility_percentile"):
        if field not in frame.columns:
            continue
        first = frame.loc[start:, field].first_valid_index()
        warm_up[field] = {
            "first_value": first.date().isoformat() if first is not None else None,
            "empty_until": (first - pd.Timedelta(days=1)).date().isoformat()
            if first is not None and first > start
            else None,
        }
    return warm_up


def _sp500_notes(
    report: dict[str, Any] | None,
    warm_up: dict[str, Any] | None,
) -> tuple[str, str]:
    """The S&P method note and its data-limits note, from this build's facts."""

    def count(number: int, word: str) -> str:
        return f"{number} {word}{'' if number == 1 else 's'}"

    def join(items: list[str]) -> str:
        return items[0] if len(items) == 1 else ", ".join(items[:-1]) + " and " + items[-1]

    report = report or {}
    first = report.get("first_close") or "1927-12-30"
    replaced = (report.get("reconciliation") or {}).get("replaced") or {}
    dropped = [
        entry
        for entry in report.get("bad_prints") or []
        if entry.get("status") == "dropped"
    ]
    tail_days = sorted((report.get("official_tail") or {}).get("closes") or {})

    fixes: list[str] = []
    if replaced:
        fixes.append(
            "official S&P 500 closes (S&P Dow Jones Indices, via FRED) replace "
            f"Yahoo's on {count(len(replaced), 'date')} where Yahoo's close was "
            "off by more than half a cent"
        )
    if dropped:
        years = sorted({entry["date"][:4] for entry in dropped})
        span = years[0] if len(years) == 1 else f"{years[0]}-{years[-1]}"
        fixes.append(
            f"isolated Yahoo misprints on {count(len(dropped), 'date')} ({span}) "
            "are dropped, so the previous close carries forward"
        )
    if tail_days:
        fixes.append(
            f"FRED's official closes fill {tail_days[0]} to {tail_days[-1]}, "
            "after Yahoo's last close"
        )
    method = (
        "S&P 500 levels are daily S&P composite closes from Yahoo Finance "
        f"(^GSPC) from {first}."
    )
    if fixes:
        text = "; ".join(fixes)
        method += (
            f" {text[0].upper()}{text[1:]}. The artifact metadata lists every "
            "such date."
        )
    method += (
        " Before 1957-03-04 the index is the S&P 90, the S&P 500's predecessor, "
        "and pre-1952 Saturday sessions are absent. Before "
        f"{first} the series is the NBER/Cowles monthly stock index "
        "(1935-39=100), forward-filled to daily. The two segments are not "
        "chained, so levels compare only within a segment; prices exclude "
        "dividends."
    )

    limits: list[str] = []
    warm = warm_up or {}
    empty = []
    for field, label in (
        ("volatility_1y", "volatility"),
        ("drawdown_1y", "drawdown"),
        ("1y_volatility_percentile", "the volatility percentile"),
    ):
        item = warm.get(field)
        until = item.get("empty_until") if isinstance(item, dict) else None
        if until:
            verb = "is empty until" if not empty else "until"
            empty.append(f"{label} {verb} {until}")
    if empty:
        limits.append(
            "The S&P 1-year volatility, drawdown and volatility-percentile "
            "windows restart where the daily series begins "
            f"({warm.get('segment_start', first)}), so {join(empty)}."
        )
    runs = report.get("flat_runs") or []
    if runs:
        longest = max(runs, key=lambda run: (run["sessions"], run["start"]))
        latest = max(runs, key=lambda run: run["start"])
        described = [
            f"the longest is {count(longest['sessions'], 'session')} at "
            f"{longest['close']:.2f} ({longest['start']} to {longest['end']})"
        ]
        if latest is not longest:
            described.append(
                f"the latest {count(latest['sessions'], 'session')} at "
                f"{latest['close']:.2f} ({latest['start']} to {latest['end']})"
            )
        limits.append(
            f"Yahoo's daily history has {count(len(runs), 'run')} of three or "
            f"more identical consecutive closes; {join(described)}. Some may be "
            "stale vendor prints; with no independent daily source to check "
            "them, they are kept as delivered and listed in the artifact "
            "metadata."
        )
    if not limits:
        limits.append("No S&P warm-up gaps or repeated-close runs were found.")
    return method, " ".join(limits)


def build_metadata(
    frame: pd.DataFrame,
    series_map: dict[str, pd.Series],
    specs: Sequence[SeriesSpec],
    warnings: Sequence[str],
    *,
    transport: str,
    api_key_present: bool,
    sp500_daily_report: dict[str, Any] | None = None,
) -> dict[str, Any]:
    series_metadata = _series_metadata(series_map, specs)
    episodes = nber_episodes(frame)

    phase_series = (
        frame["nber_phase"].dropna() if "nber_phase" in frame.columns else pd.Series(dtype="string")
    )
    current_phase = str(phase_series.iloc[-1]) if not phase_series.empty else None

    scored = (
        frame["macro_strength"].dropna()
        if "macro_strength" in frame.columns
        else pd.Series(dtype="float64")
    )
    if not scored.empty:
        latest_index = scored.index.max()
        latest_strength = {
            "date": latest_index.date().isoformat(),
            "score": round(float(scored.loc[latest_index]), 2),
            "label": str(frame.loc[latest_index, "macro_strength_label"])
            if "macro_strength_label" in frame.columns
            and not pd.isna(frame.loc[latest_index, "macro_strength_label"])
            else None,
            "regime_state": str(frame.loc[latest_index, "regime_state"])
            if "regime_state" in frame.columns
            and not pd.isna(frame.loc[latest_index, "regime_state"])
            else None,
            "coverage": round(
                float(frame.loc[latest_index, "macro_strength_coverage"]), 3
            )
            if "macro_strength_coverage" in frame.columns
            else None,
        }
    else:
        latest_strength = None

    coverage_start = None
    full_coverage_start = None
    if "macro_strength_coverage" in frame.columns:
        positive = frame.index[frame["macro_strength_coverage"] > 0.0]
        if len(positive):
            coverage_start = positive.min().date().isoformat()
        full = frame.index[frame["macro_strength_coverage"] >= 0.999]
        if len(full):
            full_coverage_start = full.min().date().isoformat()

    start = frame.index.min()
    end = frame.index.max()
    short_series = [
        series_id
        for series_id, item in series_metadata.items()
        if item["coverage_years"] < 20
    ]

    warm_up = _sp500_warm_up(frame)
    sp500_method_note, sp500_limits_note = _sp500_notes(sp500_daily_report, warm_up)
    report = sp500_daily_report or {}

    notes = [
        "NBER recession windows come from USREC and are month-precise, not day-precise.",
        "USREC is retrospective: labels reflect later NBER dating, not real-time announcements.",
        "Macro strength is a V2 coincident heuristic (Fed Funds 21d/126d panic-cut; 10y-2y level and 21d/126d un-inversion; UNRATE Sahm proxy), not a probability or forecast.",
        sp500_method_note,
        sp500_limits_note,
        "USREC is excluded from the strength inputs to avoid target leakage.",
        "Gold is the World Bank Pink Sheet London bullion benchmark forward-filled to daily; bonds are a 7.5-duration 10y UST total-return proxy; the dollar target is the broad trade-weighted index; Bitcoin is the Blockchain.com daily market price from 2010-08-18.",
        "Nifty 50 daily prices come from Yahoo Finance (^NSEI). Yahoo's history begins in 2007, so the Nifty series is intentionally unavailable before then.",
        CORE_INDEX_NOTE,
        "FRED's keyless CSV endpoint exposes only a rolling three-year ICE BofA HY OAS window. The pipeline merges FRED's recent observations with a cached public 1996+ mirror; the official FRED API path retains the full provider history.",
        "Crypto milestone dates are editorial comparison windows, not statistically detected events or NBER recession dates.",
    ]

    return {
        "pipeline_version": PIPELINE_VERSION,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": {
            "name": "FRED",
            "transport": transport,
            "api_key_present": bool(api_key_present),
        },
        "coverage": {
            "start": start.date().isoformat(),
            "end": end.date().isoformat(),
            "years": round((end - start).days / 365.25, 1),
        },
        "frame": {
            "rows": int(len(frame)),
            "columns": int(len(frame.columns)),
            "columns_list": list(frame.columns),
        },
        "series_requested": [spec.series_id for spec in specs],
        "series_loaded": list(series_map.keys()),
        "series": series_metadata,
        "nber": {
            "source": "USREC",
            "current_phase": current_phase,
            "episodes": episodes,
        },
        "strength": {
            "version": STRENGTH_VERSION,
            "feature_version": "regime-v2",
            "weights": dict(STRENGTH_WEIGHTS),
            "regime_thresholds": {
                "favorable_min": 60.0,
                "disruptive_max": 40.0,
            },
            "features": [
                "fed_roc_21d",
                "fed_cross",
                "curve_cross",
                "curve_uninversion_pressure",
                "labor_gap",
                "volatility_1y",
                "drawdown_1y",
                "1y_volatility_percentile",
            ],
            "first_scored": coverage_start,
            "full_coverage_from": full_coverage_start,
            "latest": latest_strength,
            "notes": notes[2:3],
        },
        "core_index": core_index_metadata(frame),
        "proxy": {
            "sources": _proxy_metadata(frame),
            "notes": notes[3:5],
            "reconciliation": report.get("reconciliation"),
            "bad_prints": report.get("bad_prints"),
            "official_tail": report.get("official_tail"),
            "flat_runs": report.get("flat_runs"),
            "warm_up": warm_up,
        },
        "assets": _asset_metadata(frame),
        "alignment": {
            "method": "daily calendar reindex + forward fill",
            "backfill": False,
            "native_frequencies": "preserved until the daily merge",
            "notes": notes[0:2],
        },
        "warnings": sorted({redact_secrets(warning) for warning in warnings}),
        "short_series": sorted(short_series),
        "notes": notes,
    }


def run_pipeline(
    *,
    source: str = "auto",
    series_ids: Sequence[str] | str | None = None,
    start: Any | None = None,
    end: Any | None = None,
    output_dir: Path = DEFAULT_OUTPUT_DIR,
    cache_dir: Path = DEFAULT_CACHE_DIR,
    refresh: bool = False,
    offline: bool = False,
    max_age_hours: float = 24.0,
    delay: float = 0.6,
    api_key: str | None = None,
) -> dict[str, Any]:
    specs = select_specs(series_ids)
    key = api_key if api_key is not None else get_api_key()
    client: FredClient | FredCsvClient | None = None
    transport = "cache"

    if not offline:
        client, transport = make_client(source, key, delay=delay)

    try:
        series_map, _manifest, warnings = fetch_universe(
            client,
            specs,
            cache_dir=cache_dir,
            refresh=refresh,
            offline=offline,
            max_age_hours=max_age_hours,
            start=start,
            end=end,
        )
    finally:
        if client is not None:
            client.close()

    try:
        gold = fetch_gold_series(
            cache_dir,
            refresh=refresh,
            offline=offline,
        )
        if gold is not None:
            series_map[GOLD_SERIES_ID] = gold
    except Exception as exc:  # noqa: BLE001 - supplemental target must not kill the artifact
        warnings.append(f"{GOLD_SERIES_ID}: {type(exc).__name__}: {exc}")

    try:
        bitcoin = fetch_bitcoin_series(
            cache_dir,
            refresh=refresh,
            offline=offline,
        )
        if bitcoin is not None:
            series_map[BITCOIN_SERIES_ID] = bitcoin
    except Exception as exc:  # noqa: BLE001 - supplemental target must not kill the artifact
        warnings.append(f"{BITCOIN_SERIES_ID}: {type(exc).__name__}: {exc}")

    try:
        nifty = fetch_nifty_series(
            cache_dir,
            refresh=refresh,
            offline=offline,
            warnings=warnings,
        )
        if nifty is not None:
            series_map[NIFTY_SERIES_ID] = nifty
    except Exception as exc:  # noqa: BLE001 - supplemental target must not kill the artifact
        warnings.append(f"{NIFTY_SERIES_ID}: {type(exc).__name__}: {exc}")

    # The daily S&P history is required: without it the S&P series would have a
    # 1956-2016 hole, so a missing or truncated history stops the build before
    # anything is written.
    try:
        sp500_daily = fetch_sp500_daily_series(
            cache_dir,
            refresh=refresh,
            offline=offline,
            warnings=warnings,
        )
    except Exception as exc:  # noqa: BLE001 - re-raised as a refusal to write
        raise SeriesShapeError(
            f"{SP500_DAILY_SERIES_ID}: daily S&P history unavailable "
            f"({type(exc).__name__}: {exc}); the artifact is not written"
        ) from exc
    sp500_daily, sp500_daily_report = prepare_sp500_daily(
        sp500_daily,
        series_map.get("SP500"),
        warnings=warnings,
    )
    series_map[SP500_DAILY_SERIES_ID] = sp500_daily

    try:
        ensure_high_yield_history(
            series_map,
            cache_dir,
            refresh=refresh,
            offline=offline,
        )
    except Exception as exc:  # noqa: BLE001 - optional full-history backfill
        warnings.append(f"BAMLH0A0HYM2 archive: {type(exc).__name__}: {exc}")

    frame = build_macro_frame(series_map, start=start, end=end)
    frame = annotate_nber(frame)

    raw_frame = build_raw_daily_frame(series_map, frame.index)
    proxy = build_sp500_proxy(frame, raw_frame=raw_frame)
    frame = frame.join(proxy)
    frame = build_asset_targets(frame)

    strength = calculate_macro_strength_components(frame)
    frame = frame.join(strength)
    core_index = calculate_core_index(frame)
    frame = frame.join(core_index)

    output_dir = Path(output_dir)
    parquet_path = output_dir / "macro_regime_history.parquet"
    metadata_path = output_dir / "macro_regime_history.meta.json"

    _write_parquet(frame, parquet_path)
    data_version = hashlib.sha256(parquet_path.read_bytes()).hexdigest()[:12]

    metadata = build_metadata(
        frame,
        series_map,
        specs,
        warnings,
        transport=transport,
        api_key_present=bool(key),
        sp500_daily_report=sp500_daily_report,
    )
    metadata["data_version"] = data_version
    _write_json(metadata_path, metadata)
    crypto_path = write_crypto_milestones_artifact(
        output_dir / CRYPTO_MILESTONES_FILENAME
    )
    patterns_skill_path = write_patterns_skill_artifact(
        frame, output_dir, data_version=data_version
    )

    return {
        "rows": int(len(frame)),
        "columns": int(len(frame.columns)),
        "start": frame.index.min().date().isoformat(),
        "end": frame.index.max().date().isoformat(),
        "series_loaded": len(series_map),
        "nber_episodes": len(metadata["nber"]["episodes"]),
        "latest_strength": metadata["strength"]["latest"],
        "latest_core_index": metadata["core_index"]["latest"],
        "data_version": data_version,
        "transport": transport,
        "parquet": str(parquet_path),
        "metadata": str(metadata_path),
        "crypto_milestones": str(crypto_path),
        "patterns_v2_skill": (
            str(patterns_skill_path) if patterns_skill_path is not None else None
        ),
    }


def write_patterns_skill_artifact(
    frame: pd.DataFrame,
    output_dir: Path,
    *,
    data_version: str,
) -> Path | None:
    """Regenerate the Study of Patterns v2 skill artifact for this parquet.

    Never fatal: on failure the artifact is left as it was and a warning is
    logged; the CI check that its data_version matches the metadata then
    flags the stale file before a deploy.
    """
    try:
        from scripts.patterns_v2_evidence import write_skill_artifact

        return write_skill_artifact(
            frame,
            Path(output_dir) / PATTERNS_V2_SKILL_FILENAME,
            data_version=data_version,
        )
    except Exception as exc:  # noqa: BLE001 - supplemental artifact must not kill the run
        logger.warning(
            "Patterns v2 skill artifact not written: {}: {}",
            type(exc).__name__,
            exc,
        )
        return None


def check_key(delay: float = 0.0) -> dict[str, Any]:
    key = get_api_key()
    if not key:
        raise MacroConfigError(
            "FRED_API_KEY is not set. Add it to backend/.env or use --source csv."
        )
    client = FredClient(key, delay=delay)
    try:
        return client.series_info("USREC")
    finally:
        client.close()


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Ingest the FRED macro universe and write the regime artifact."
    )
    parser.add_argument(
        "--source",
        choices=("auto", "api", "csv"),
        default="auto",
        help="FRED transport. auto uses the API when FRED_API_KEY is present.",
    )
    parser.add_argument(
        "--series",
        default=None,
        help="Comma-separated series IDs from the registry. Default: all 75.",
    )
    parser.add_argument("--start", default=None, help="Optional YYYY-MM-DD start.")
    parser.add_argument("--end", default=None, help="Optional YYYY-MM-DD end.")
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_OUTPUT_DIR,
        help="Directory for macro_regime_history.parquet and its metadata.",
    )
    parser.add_argument(
        "--cache-dir",
        type=Path,
        default=DEFAULT_CACHE_DIR,
        help="Directory for per-series CSV caches.",
    )
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--refresh", action="store_true", help="Ignore fresh caches.")
    mode.add_argument(
        "--offline",
        action="store_true",
        help="Build from the local cache only; no FRED requests.",
    )
    parser.add_argument(
        "--max-age-hours",
        type=float,
        default=24.0,
        help="Cache freshness window when --refresh is not set.",
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=0.6,
        help="Seconds to sleep between FRED requests.",
    )
    parser.add_argument(
        "--check-key",
        action="store_true",
        help="Validate FRED_API_KEY with a lightweight series metadata request.",
    )
    parser.add_argument("--verbose", action="store_true")
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    _configure_logging(args.verbose)

    try:
        if args.check_key:
            info = check_key(delay=args.delay)
            logger.success(
                "FRED auth OK: {} - {} ({})",
                info.get("id"),
                info.get("title"),
                info.get("frequency"),
            )
            return 0

        result = run_pipeline(
            source=args.source,
            series_ids=args.series,
            start=args.start,
            end=args.end,
            output_dir=args.output_dir,
            cache_dir=args.cache_dir,
            refresh=args.refresh,
            offline=args.offline,
            max_age_hours=args.max_age_hours,
            delay=args.delay,
        )
        logger.success(
            "Wrote {} rows x {} columns ({} -> {}) via {}",
            result["rows"],
            result["columns"],
            result["start"],
            result["end"],
            result["transport"],
        )
        logger.success(
            "Artifact: {} (data_version {})",
            result["parquet"],
            result["data_version"],
        )
        if result["latest_strength"]:
            logger.info("Latest strength: {}", result["latest_strength"])
        logger.info("NBER episodes: {}", result["nber_episodes"])
        return 0
    except (MacroConfigError, FredAuthError) as exc:
        logger.error("{}", exc)
        logger.error(
            "For CI, add the FRED_API_KEY repository secret. "
            "For local runs, put FRED_API_KEY in backend/.env."
        )
        return 2
    except FredAPIError as exc:
        logger.error("FRED ingestion failed: {}", exc)
        return 1
    except Exception as exc:  # noqa: BLE001 - CLI boundary
        logger.exception("Macro ingestion failed: {}", exc)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
