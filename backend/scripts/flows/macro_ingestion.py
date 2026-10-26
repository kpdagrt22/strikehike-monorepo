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
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Sequence

import numpy as np
import pandas as pd
import requests
from dotenv import load_dotenv
from loguru import logger

BACKEND_DIR = Path(__file__).resolve().parents[2]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from regime.analytics import (  # noqa: E402
    STRENGTH_VERSION,
    STRENGTH_WEIGHTS,
    annotate_nber,
    build_sp500_proxy,
    calculate_macro_strength_components,
    nber_episodes,
)

REPO_DIR = BACKEND_DIR.parent
DEFAULT_CACHE_DIR = BACKEND_DIR / "data" / "raw" / "fred"
DEFAULT_OUTPUT_DIR = BACKEND_DIR / "data" / "processed"
FRED_API_BASE = "https://api.stlouisfed.org/fred"
FRED_CSV_URL = "https://fred.stlouisfed.org/graph/fredgraph.csv"
USER_AGENT = "strikehike-regime-intelligence/phase1 (+https://strikehike.com)"
PIPELINE_VERSION = "phase1-v1"


# ---------------------------------------------------------------------------
# Errors and configuration
# ---------------------------------------------------------------------------


class MacroConfigError(RuntimeError):
    """Missing key, bad CLI combination, or an unusable cache."""


class FredAPIError(RuntimeError):
    """FRED returned an unexpected response or exhausted retries."""


class FredAuthError(FredAPIError):
    """The FRED API key is missing or rejected."""


def load_environment() -> None:
    """Load backend/.env and repo-root .env without overriding real env vars."""
    for path in (BACKEND_DIR / ".env", REPO_DIR / ".env"):
        if path.exists():
            load_dotenv(path, override=False)


def get_api_key() -> str | None:
    load_environment()
    key = os.getenv("FRED_API_KEY", "").strip()
    return key or None


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
# and Dow-Jones series instead. Add a SeriesSpec to grow toward the 60+ target.
SERIES_REGISTRY: tuple[SeriesSpec, ...] = (
    # Core requested series.
    _spec("USREC", "NBER based recession indicator", "M", "Index (0/1)", "cycle", "core"),
    _spec("T10Y2Y", "10-year minus 2-year Treasury spread", "D", "Percent", "rates", "core"),
    _spec("FEDFUNDS", "Effective federal funds rate", "M", "Percent", "rates", "core"),
    _spec("CPIAUCSL", "CPI for all urban consumers", "M", "Index 1982-84=100", "inflation", "core"),
    _spec("PPIACO", "PPI for all commodities", "M", "Index 1982=100", "inflation", "core"),
    # Long-run equity proxy (see build_sp500_proxy).
    _spec("M1125AUSM343NNBR", "Cowles/S&P common stock price index", "M", "Index 1935-39=100", "markets", "proxy"),
    _spec("M1109BUSM293NNBR", "Dow-Jones industrial stock price index", "M", "USD per share", "markets", "proxy"),
    _spec("SP500", "S&P 500", "D", "Index", "markets", "proxy"),
    _spec("NASDAQCOM", "Nasdaq composite", "D", "Index", "markets", "proxy"),
    # Rates and credit.
    _spec("DGS10", "10-year Treasury constant maturity", "D", "Percent", "rates"),
    _spec("DGS2", "2-year Treasury constant maturity", "D", "Percent", "rates"),
    _spec("DGS5", "5-year Treasury constant maturity", "D", "Percent", "rates"),
    _spec("DGS30", "30-year Treasury constant maturity", "D", "Percent", "rates"),
    _spec("DGS3MO", "3-month Treasury constant maturity", "D", "Percent", "rates"),
    _spec("T10Y3M", "10-year minus 3-month Treasury spread", "D", "Percent", "rates"),
    _spec("DFF", "Effective federal funds rate (daily)", "D", "Percent", "rates"),
    _spec("BAA10Y", "Moody's Baa minus 10-year Treasury", "D", "Percent", "rates"),
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

            message = _fred_error_message(response)
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

        raise FredAPIError(f"FRED request failed after retries: {last_error}")

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
                message = f"{series_id}: fetch failed ({type(exc).__name__}: {exc})"
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


def build_metadata(
    frame: pd.DataFrame,
    series_map: dict[str, pd.Series],
    specs: Sequence[SeriesSpec],
    warnings: Sequence[str],
    *,
    transport: str,
    api_key_present: bool,
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

    notes = [
        "NBER recession windows come from USREC and are month-precise, not day-precise.",
        "USREC is retrospective: labels reflect later NBER dating, not real-time announcements.",
        "Macro strength is a V1 heuristic (Fed Funds 1y/3y MA crossover; 10y-2y level and 3m/1y crossover), not a probability or forecast.",
        "The long-run equity proxy splices NBER/Cowles, Dow-Jones, Nasdaq and S&P 500 levels; it is not chained and gaps are preserved.",
        "USREC is excluded from the strength inputs to avoid target leakage.",
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
            "feature_version": "regime-v1",
            "weights": dict(STRENGTH_WEIGHTS),
            "regime_thresholds": {
                "favorable_min": 60.0,
                "disruptive_max": 40.0,
            },
            "features": [
                "fed_cross",
                "curve_cross",
                "volatility_1y",
                "drawdown_1y",
                "1y_volatility_percentile",
            ],
            "first_scored": coverage_start,
            "full_coverage_from": full_coverage_start,
            "latest": latest_strength,
            "notes": notes[2:3],
        },
        "proxy": {
            "sources": _proxy_metadata(frame),
            "notes": notes[3:4],
        },
        "alignment": {
            "method": "daily calendar reindex + forward fill",
            "backfill": False,
            "native_frequencies": "preserved until the daily merge",
            "notes": notes[0:2],
        },
        "warnings": sorted(set(warnings)),
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

    frame = build_macro_frame(series_map, start=start, end=end)
    frame = annotate_nber(frame)

    raw_frame = build_raw_daily_frame(series_map, frame.index)
    proxy = build_sp500_proxy(frame, raw_frame=raw_frame)
    frame = frame.join(proxy)

    strength = calculate_macro_strength_components(frame)
    frame = frame.join(strength)

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
    )
    metadata["data_version"] = data_version
    _write_json(metadata_path, metadata)

    return {
        "rows": int(len(frame)),
        "columns": int(len(frame.columns)),
        "start": frame.index.min().date().isoformat(),
        "end": frame.index.max().date().isoformat(),
        "series_loaded": len(series_map),
        "nber_episodes": len(metadata["nber"]["episodes"]),
        "latest_strength": metadata["strength"]["latest"],
        "data_version": data_version,
        "transport": transport,
        "parquet": str(parquet_path),
        "metadata": str(metadata_path),
    }


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
