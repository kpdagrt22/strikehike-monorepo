"""Read-only macro-regime service.

Loads the Phase 1 parquet artifact once, checks its mtime on every request, and
builds the downsampled timeline plus NBER crash objects for the API. The service
does not call FRED; ingestion is a separate offline pipeline.
"""

from __future__ import annotations

import json
import logging
import statistics
import threading
from datetime import date
from pathlib import Path
from typing import Any, Literal

import numpy as np
import pandas as pd

from regime.analytics import (
    CORE_INDEX_VERSION,
    STRENGTH_VERSION,
    STRENGTH_WEIGHTS,
    build_crashes,
)
from regime.crypto_milestones import (
    CRYPTO_MILESTONES_VERSION,
    milestone_definitions,
)
from regime.cases import window_stats
from regime import patterns_v2
from regime.schemas import PatternEngineV2

logger = logging.getLogger(__name__)

BACKEND_DIR = Path(__file__).resolve().parents[1]
DEFAULT_ARTIFACT = BACKEND_DIR / "data" / "processed" / "macro_regime_history.parquet"
DEFAULT_META = BACKEND_DIR / "data" / "processed" / "macro_regime_history.meta.json"
DEFAULT_CRYPTO_MILESTONES = (
    BACKEND_DIR / "data" / "processed" / "crypto_milestones.json"
)
PATTERNS_EVENTS_PATH = Path(__file__).with_name("patterns_events.json")

Resolution = Literal["auto", "daily", "weekly", "monthly"]
REGIME_STATES = ("favorable", "neutral", "disruptive")
EVENT_ASSETS = {
    "sp500": ("sp500_proxy", "S&P 500"),
    "gold": ("gold_proxy", "Gold — London bullion"),
    "bonds": ("bond_proxy", "Treasury bonds"),
    "bitcoin": ("btc_proxy", "Bitcoin"),
    "nifty": ("nifty_proxy", "Nifty 50 — India"),
}


def _to_timestamp(value: Any) -> pd.Timestamp:
    timestamp = pd.Timestamp(value)
    if timestamp.tzinfo is None:
        timestamp = timestamp.tz_localize("UTC")
    else:
        timestamp = timestamp.tz_convert("UTC")
    return timestamp


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


def _read_json(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return payload if isinstance(payload, dict) else {}


def _choose_resolution(
    requested: Resolution,
    start: pd.Timestamp,
    end: pd.Timestamp,
) -> str:
    if requested != "auto":
        return requested
    days = (end - start).days
    if days <= 730:
        return "daily"
    if days <= 30 * 365:
        return "weekly"
    return "monthly"


def _downsample(frame: pd.DataFrame, resolution: str) -> pd.DataFrame:
    columns = [
        column
        for column in (
            "macro_strength",
            "macro_strength_coverage",
            "regime_state",
            "core_index",
            "core_index_composite",
            "core_index_bucket",
            "core_index_severity",
            "core_index_warning",
            "core_index_trend_warning",
            "macro_score",
            "credit_score",
            "core_volatility_score",
            "core_momentum_score",
            "hy_oas",
            "atr_pct",
            "bollinger_width",
            "rsi_14",
            "macd",
            "macd_hist",
            "sp500_proxy",
            "sp500_proxy_source",
            "volatility_1y",
            "drawdown_1y",
            "1y_volatility_percentile",
            "gold_proxy",
            "gold_proxy_source",
            "gold_volatility_1y",
            "gold_drawdown_1y",
            "gold_1y_volatility_percentile",
            "bond_proxy",
            "bond_proxy_source",
            "bond_volatility_1y",
            "bond_drawdown_1y",
            "bond_1y_volatility_percentile",
            "btc_proxy",
            "btc_proxy_source",
            "btc_volatility_1y",
            "btc_drawdown_1y",
            "btc_1y_volatility_percentile",
            "nifty_proxy",
            "nifty_proxy_source",
            "nifty_volatility_1y",
            "nifty_drawdown_1y",
            "nifty_1y_volatility_percentile",
            "dxy_proxy",
            "dxy_proxy_source",
            "dxy_volatility_1y",
            "dxy_drawdown_1y",
            "dxy_1y_volatility_percentile",
            "nber_recession",
            "nber_episode",
            "FEDFUNDS",
            "T10Y2Y",
        )
        if column in frame.columns
    ]
    subset = frame[columns].copy()
    if resolution == "daily":
        return subset

    rule = "W-FRI" if resolution == "weekly" else pd.offsets.MonthEnd()
    aggregation: dict[str, str] = {column: "last" for column in columns}
    if "nber_recession" in aggregation:
        aggregation["nber_recession"] = "max"
    resampled = subset.resample(rule).agg(aggregation)
    if resampled.empty:
        return subset.copy()
    # A right-labelled weekly/monthly bucket can end after the last observation.
    resampled = resampled.loc[: subset.index.max()]
    # Keep the current partial bucket visible so the HUD and the header stat
    # agree on the latest daily Core Index reading.
    if not resampled.empty and subset.index[-1] > resampled.index[-1]:
        resampled.loc[subset.index[-1]] = subset.iloc[-1]
    return resampled


def _timeline_points(frame: pd.DataFrame) -> list[dict[str, Any]]:
    points: list[dict[str, Any]] = []
    for timestamp, row in frame.iterrows():
        strength = _as_float(row.get("macro_strength"), 2)
        core_index = _as_float(row.get("core_index"), 2)
        sp500 = _as_float(row.get("sp500_proxy"), 2)
        usrec = _as_int(row.get("nber_recession"))
        if strength is None and core_index is None and sp500 is None and usrec is None:
            continue
        phase = (
            "recession"
            if usrec == 1
            else "expansion"
            if usrec == 0
            else None
        )
        points.append(
            {
                "date": timestamp.date().isoformat(),
                "strength": strength,
                "regime_state": _as_str(row.get("regime_state")),
                "core_index": core_index,
                "core_index_composite": _as_float(
                    row.get("core_index_composite"), 2
                ),
                "core_index_bucket": _as_str(row.get("core_index_bucket")),
                "core_index_severity": _as_str(
                    row.get("core_index_severity")
                ),
                "core_index_warning": _as_bool(
                    row.get("core_index_warning")
                ),
                "core_index_trend_warning": _as_bool(
                    row.get("core_index_trend_warning")
                ),
                "macro_score": _as_float(row.get("macro_score"), 2),
                "credit_score": _as_float(row.get("credit_score"), 2),
                "core_volatility_score": _as_float(
                    row.get("core_volatility_score"), 2
                ),
                "core_momentum_score": _as_float(
                    row.get("core_momentum_score"), 2
                ),
                "hy_oas": _as_float(row.get("hy_oas"), 3),
                "atr_pct": _as_float(row.get("atr_pct"), 3),
                "bollinger_width": _as_float(
                    row.get("bollinger_width"), 3
                ),
                "rsi_14": _as_float(row.get("rsi_14"), 2),
                "macd": _as_float(row.get("macd"), 4),
                "macd_hist": _as_float(row.get("macd_hist"), 4),
                "volatility_1y": _as_float(row.get("volatility_1y"), 2),
                "drawdown_1y": _as_float(row.get("drawdown_1y"), 2),
                "1y_volatility_percentile": _as_float(
                    row.get("1y_volatility_percentile"), 1
                ),
                "sp500_proxy": sp500,
                "proxy_source": _as_str(row.get("sp500_proxy_source")),
                "gold_proxy": _as_float(row.get("gold_proxy"), 2),
                "gold_proxy_source": _as_str(
                    row.get("gold_proxy_source")
                ),
                "gold_volatility_1y": _as_float(
                    row.get("gold_volatility_1y"), 2
                ),
                "gold_drawdown_1y": _as_float(
                    row.get("gold_drawdown_1y"), 2
                ),
                "gold_1y_volatility_percentile": _as_float(
                    row.get("gold_1y_volatility_percentile"), 1
                ),
                "bond_proxy": _as_float(row.get("bond_proxy"), 2),
                "bond_proxy_source": _as_str(
                    row.get("bond_proxy_source")
                ),
                "bond_volatility_1y": _as_float(
                    row.get("bond_volatility_1y"), 2
                ),
                "bond_drawdown_1y": _as_float(
                    row.get("bond_drawdown_1y"), 2
                ),
                "bond_1y_volatility_percentile": _as_float(
                    row.get("bond_1y_volatility_percentile"), 1
                ),
                "btc_proxy": _as_float(row.get("btc_proxy"), 2),
                "btc_proxy_source": _as_str(row.get("btc_proxy_source")),
                "btc_volatility_1y": _as_float(
                    row.get("btc_volatility_1y"), 2
                ),
                "btc_drawdown_1y": _as_float(
                    row.get("btc_drawdown_1y"), 2
                ),
                "btc_1y_volatility_percentile": _as_float(
                    row.get("btc_1y_volatility_percentile"), 1
                ),
                "nifty_proxy": _as_float(row.get("nifty_proxy"), 2),
                "nifty_proxy_source": _as_str(
                    row.get("nifty_proxy_source")
                ),
                "nifty_volatility_1y": _as_float(
                    row.get("nifty_volatility_1y"), 2
                ),
                "nifty_drawdown_1y": _as_float(
                    row.get("nifty_drawdown_1y"), 2
                ),
                "nifty_1y_volatility_percentile": _as_float(
                    row.get("nifty_1y_volatility_percentile"), 1
                ),
                "dxy_proxy": _as_float(row.get("dxy_proxy"), 2),
                "dxy_proxy_source": _as_str(
                    row.get("dxy_proxy_source")
                ),
                "dxy_volatility_1y": _as_float(
                    row.get("dxy_volatility_1y"), 2
                ),
                "dxy_drawdown_1y": _as_float(
                    row.get("dxy_drawdown_1y"), 2
                ),
                "dxy_1y_volatility_percentile": _as_float(
                    row.get("dxy_1y_volatility_percentile"), 1
                ),
                "usrec": usrec,
                "phase": phase,
                "nber_episode": _as_int(row.get("nber_episode")),
                "fed_funds": _as_float(row.get("FEDFUNDS"), 4),
                "t10y2y": _as_float(row.get("T10Y2Y"), 4),
                "strength_coverage": _as_float(
                    row.get("macro_strength_coverage"), 3
                ),
            }
        )
    return points


def _proxy_sources_from_frame(frame: pd.DataFrame) -> list[dict[str, Any]]:
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


def _value_on_or_before(
    frame: pd.DataFrame,
    column: str,
    when: str,
) -> tuple[float | None, str | None]:
    if column not in frame.columns:
        return None, None
    series = pd.to_numeric(frame[column], errors="coerce").loc[:when].dropna()
    if series.empty:
        return None, None
    return float(series.iloc[-1]), series.index[-1].date().isoformat()


def _event_core_index(
    frame: pd.DataFrame,
    start: str,
    end: str,
    peak: str,
    trough: str | None,
) -> dict[str, Any]:
    if "core_index" not in frame.columns:
        return {}
    series = pd.to_numeric(frame["core_index"], errors="coerce").loc[start:end].dropna()
    at_peak, peak_asof = _value_on_or_before(frame, "core_index", peak)
    trough_date = trough or end
    at_trough, trough_asof = _value_on_or_before(
        frame, "core_index", trough_date
    )
    bucket_at_peak = None
    bucket_at_trough = None
    if peak_asof is not None and "core_index_bucket" in frame.columns:
        bucket_at_peak = _as_str(frame.loc[peak_asof, "core_index_bucket"])
    if trough_asof is not None and "core_index_bucket" in frame.columns:
        bucket_at_trough = _as_str(frame.loc[trough_asof, "core_index_bucket"])
    return {
        "at_peak": round(at_peak, 2) if at_peak is not None else None,
        "at_peak_date": peak_asof,
        "at_peak_bucket": bucket_at_peak,
        "at_trough": round(at_trough, 2) if at_trough is not None else None,
        "at_trough_date": trough_asof,
        "at_trough_bucket": bucket_at_trough,
        "min": round(float(series.min()), 2) if not series.empty else None,
        "min_date": series.idxmin().date().isoformat() if not series.empty else None,
        "max": round(float(series.max()), 2) if not series.empty else None,
        "max_date": series.idxmax().date().isoformat() if not series.empty else None,
        "observations": int(series.size),
    }


class MacroRegimeService:
    def __init__(
        self,
        artifact_path: Path | str = DEFAULT_ARTIFACT,
        meta_path: Path | str = DEFAULT_META,
        crypto_milestones_path: Path | str = DEFAULT_CRYPTO_MILESTONES,
        patterns_skill_path: Path | str | None = None,
    ) -> None:
        self.artifact_path = Path(artifact_path)
        self.meta_path = Path(meta_path)
        self.crypto_milestones_path = Path(crypto_milestones_path)
        # The Study of Patterns v2 skill artifact sits next to the parquet.
        self.patterns_skill_path = (
            Path(patterns_skill_path)
            if patterns_skill_path is not None
            else self.artifact_path.parent / patterns_v2.SKILL_FILENAME
        )
        self._frame: pd.DataFrame | None = None
        self._meta: dict[str, Any] = {}
        self._crashes: list[dict[str, Any]] = []
        self._mtime: float | None = None
        self._meta_mtime: float | None = None
        self._cache: dict[tuple[str, str, str], dict[str, Any]] = {}
        self._forecast_cache: dict[str, Any] | None = None
        # Study of Patterns v2: one engine block per asset, kept until the
        # parquet, its metadata or the skill artifact changes.
        self._patterns_engine_cache: dict[
            str, tuple[tuple[Any, ...], dict[str, Any]]
        ] = {}
        self._patterns_skill: tuple[Any, dict[str, Any] | None] | None = None
        self._patterns_events: list[dict[str, Any]] | None = None
        self._lock = threading.RLock()

    def _load(self) -> pd.DataFrame:
        with self._lock:
            if not self.artifact_path.exists():
                raise FileNotFoundError(
                    f"Macro regime artifact not found at {self.artifact_path}. "
                    "Run: python -m scripts.flows.macro_ingestion"
                )
            mtime = self.artifact_path.stat().st_mtime
            meta_mtime = (
                self.meta_path.stat().st_mtime
                if self.meta_path.exists()
                else None
            )
            if (
                self._frame is None
                or mtime != self._mtime
                or meta_mtime != self._meta_mtime
            ):
                frame = pd.read_parquet(self.artifact_path)
                frame.index = pd.to_datetime(frame.index, utc=True)
                frame = frame.sort_index()
                self._frame = frame
                self._mtime = mtime
                self._meta_mtime = meta_mtime
                self._meta = _read_json(self.meta_path)
                self._crashes = build_crashes(frame)
                self._cache.clear()
                self._patterns_engine_cache.clear()
                self._forecast_cache = None
            return self._frame

    def _meta_payload(self, frame: pd.DataFrame) -> dict[str, Any]:
        proxy_sources = self._meta.get("proxy", {}).get("sources")
        if not proxy_sources:
            proxy_sources = _proxy_sources_from_frame(frame)
        strength = self._meta.get("strength", {})
        core_index = self._meta.get("core_index", {})
        source = self._meta.get("source", {})
        notes = self._meta.get("notes") or [
            "Descriptive historical classification. Not a forecast or investment advice."
        ]
        return {
            "generated_at": self._meta.get("generated_at"),
            "data_version": self._meta.get("data_version"),
            "strength_version": strength.get("version", STRENGTH_VERSION),
            "feature_version": strength.get("feature_version"),
            "strength_weights": strength.get("weights", dict(STRENGTH_WEIGHTS)),
            "regime_thresholds": strength.get("regime_thresholds"),
            "latest_strength": strength.get("latest"),
            "core_index_version": core_index.get("version", CORE_INDEX_VERSION),
            "core_index_weights": core_index.get("weights"),
            "core_index_buckets": core_index.get("buckets"),
            "core_index_severities": core_index.get("severities"),
            "core_index_first_scored": core_index.get("first_scored"),
            "core_index_cadence": core_index.get("cadence"),
            "core_index_trend_warning": core_index.get("trend_warning"),
            "latest_core_index": core_index.get("latest"),
            "proxy_sources": proxy_sources,
            "nber_source": self._meta.get("nber", {}).get("source", "USREC"),
            "transport": source.get("transport"),
            "assets": self._meta.get("assets"),
            "notes": notes,
        }

    def macro_history(
        self,
        resolution: Resolution = "auto",
        start: date | str | None = None,
        end: date | str | None = None,
    ) -> dict[str, Any]:
        frame = self._load()

        start_timestamp = (
            _to_timestamp(start) if start is not None else frame.index.min()
        )
        end_timestamp = (
            _to_timestamp(end) if end is not None else frame.index.max()
        )
        if start_timestamp > end_timestamp:
            raise ValueError("start must be earlier than or equal to end")

        subset = frame.loc[start_timestamp:end_timestamp]
        if subset.empty:
            raise ValueError(
                "No macro observations in the requested range. "
                f"Artifact coverage is {frame.index.min().date()} to {frame.index.max().date()}."
            )

        actual_resolution = _choose_resolution(
            resolution, start_timestamp, end_timestamp
        )
        if actual_resolution == "daily" and len(subset) > 20_000:
            raise ValueError(
                "Daily resolution is limited to 20,000 rows; "
                "use weekly or monthly for long ranges."
            )

        cache_key = (
            actual_resolution,
            start_timestamp.date().isoformat(),
            end_timestamp.date().isoformat(),
        )
        with self._lock:
            cached = self._cache.get(cache_key)
        if cached is not None:
            return cached

        downsampled = _downsample(subset, actual_resolution)
        timeline = _timeline_points(downsampled)
        if not timeline:
            raise ValueError("No timeline points in the requested range")

        returned_start = timeline[0]["date"]
        returned_end = timeline[-1]["date"]
        payload = {
            "as_of": frame.index.max().date().isoformat(),
            "coverage": {
                "start": frame.index.min().date().isoformat(),
                "end": frame.index.max().date().isoformat(),
                "years": round(
                    (frame.index.max() - frame.index.min()).days / 365.25, 1
                ),
            },
            "range": {"start": returned_start, "end": returned_end},
            "resolution": actual_resolution,
            "point_count": len(timeline),
            "timeline": timeline,
            "crashes": self._crashes,
            "meta": self._meta_payload(frame),
        }

        with self._lock:
            self._cache[cache_key] = payload
            if len(self._cache) > 8:
                self._cache.clear()
        return payload

    def regime_runs(
        self,
        start: date | str | None = None,
        end: date | str | None = None,
    ) -> dict[str, Any]:
        """Monthly regime runs, transition probabilities and median durations."""
        frame = self._load()

        start_timestamp = (
            _to_timestamp(start) if start is not None else frame.index.min()
        )
        end_timestamp = (
            _to_timestamp(end) if end is not None else frame.index.max()
        )
        if start_timestamp > end_timestamp:
            raise ValueError("start must be earlier than or equal to end")

        subset = frame.loc[start_timestamp:end_timestamp]
        if subset.empty:
            raise ValueError(
                "No macro observations in the requested range. "
                f"Artifact coverage is {frame.index.min().date()} to {frame.index.max().date()}."
            )

        monthly = _downsample(subset, "monthly")
        required = {"regime_state", "macro_strength_coverage"}
        if not required.issubset(monthly.columns):
            raise ValueError(
                "The macro artifact does not contain regime_state. "
                "Rebuild it with the Phase 1.5 pipeline."
            )

        sample = monthly.loc[
            monthly["macro_strength_coverage"] >= 0.99
        ].dropna(subset=["regime_state"])
        sample = sample[sample["regime_state"].isin(REGIME_STATES)]
        if len(sample) < 2:
            raise ValueError(
                "Not enough full-coverage regime observations for a transition matrix."
            )

        states = sample["regime_state"].astype(str).tolist()
        runs: list[dict[str, Any]] = []
        run_start = 0

        for index in range(1, len(states) + 1):
            if index < len(states) and states[index] == states[run_start]:
                continue

            run = sample.iloc[run_start:index]
            run_start_date = run.index[0]
            run_end_date = run.index[-1]
            vol_values = (
                pd.to_numeric(
                    run["1y_volatility_percentile"], errors="coerce"
                ).dropna()
                if "1y_volatility_percentile" in run.columns
                else pd.Series(dtype="float64")
            )
            runs.append(
                {
                    "state": states[run_start],
                    "start": run_start_date.date().isoformat(),
                    "end": run_end_date.date().isoformat(),
                    "duration_days": int(
                        (run_end_date - run_start_date).days
                    )
                    + 1,
                    "duration_months": int(index - run_start),
                    "start_volatility_percentile": _as_float(
                        vol_values.iloc[0], 1
                    )
                    if not vol_values.empty
                    else None,
                    "end_volatility_percentile": _as_float(
                        vol_values.iloc[-1], 1
                    )
                    if not vol_values.empty
                    else None,
                    "median_volatility_percentile": _as_float(
                        vol_values.median(), 1
                    )
                    if not vol_values.empty
                    else None,
                }
            )
            run_start = index

        counts = {
            state: {next_state: 0 for next_state in REGIME_STATES}
            for state in REGIME_STATES
        }
        for previous, next_state in zip(states, states[1:]):
            counts[previous][next_state] += 1

        probabilities: dict[str, dict[str, float | None]] = {}
        for state in REGIME_STATES:
            total = sum(counts[state].values())
            probabilities[state] = {
                next_state: (
                    round(counts[state][next_state] / total, 4)
                    if total
                    else None
                )
                for next_state in REGIME_STATES
            }

        durations = {state: [] for state in REGIME_STATES}
        for run in runs:
            durations[run["state"]].append(run["duration_months"])

        median_duration = {
            state: (
                float(statistics.median(durations[state]))
                if durations[state]
                else None
            )
            for state in REGIME_STATES
        }

        return {
            "as_of": frame.index.max().date().isoformat(),
            "coverage": {
                "start": frame.index.min().date().isoformat(),
                "end": frame.index.max().date().isoformat(),
                "years": round(
                    (frame.index.max() - frame.index.min()).days / 365.25,
                    1,
                ),
            },
            "resolution": "monthly",
            "states": list(REGIME_STATES),
            "sample": {
                "start": sample.index[0].date().isoformat(),
                "end": sample.index[-1].date().isoformat(),
                "observations": int(len(sample)),
            },
            "runs": runs,
            "transitions": {
                "states": list(REGIME_STATES),
                "counts": counts,
                "probabilities": probabilities,
                "median_duration_months": median_duration,
                "run_counts": {
                    state: len(durations[state]) for state in REGIME_STATES
                },
                "sample_start": sample.index[0].date().isoformat(),
                "sample_end": sample.index[-1].date().isoformat(),
                "sample_observations": int(len(sample)),
            },
            "meta": self._meta_payload(frame),
        }

    def crypto_milestones(self) -> dict[str, Any]:
        """Editorial crypto windows enriched with asset and Core Index readings."""
        frame = self._load()
        artifact = _read_json(self.crypto_milestones_path)
        definitions = artifact.get("events")
        if not isinstance(definitions, list) or not definitions:
            definitions = milestone_definitions()

        events: list[dict[str, Any]] = []
        for definition in definitions:
            if not isinstance(definition, dict):
                continue
            item = dict(definition)
            window = item.get("window") or {}
            start = str(window.get("start") or "")
            end = str(window.get("end") or "")
            peak = str(item.get("peak") or start)
            trough = item.get("trough")
            if not start or not end:
                continue

            assets: dict[str, Any] = {}
            for key, (column, label) in EVENT_ASSETS.items():
                stats = window_stats(frame, start, end, column)
                assets[key] = {
                    "label": label,
                    "available": stats is not None,
                    **(stats or {}),
                }
            item["assets"] = assets
            item["core_index"] = _event_core_index(
                frame,
                start,
                end,
                peak,
                str(trough) if trough else None,
            )
            events.append(item)

        return {
            "as_of": frame.index.max().date().isoformat(),
            "coverage": {
                "start": frame.index.min().date().isoformat(),
                "end": frame.index.max().date().isoformat(),
                "years": round(
                    (frame.index.max() - frame.index.min()).days / 365.25,
                    1,
                ),
            },
            "version": artifact.get("version", CRYPTO_MILESTONES_VERSION),
            "kind": "editorial",
            "assets": {
                key: label for key, (_, label) in EVENT_ASSETS.items()
            },
            "events": events,
            "notes": [
                "Event windows are hand-curated comparison windows, not statistically detected crash dates.",
                "Core Index is the weekly S&P 500 trend-and-stress reading from the same long-run artifact; it is not a crypto-specific model.",
                "Bitcoin prices are Blockchain.com daily market prices from 2010-08-18; Genesis predates a market quote.",
                "Astrology is a historical lens, not a forecast or causal claim.",
            ],
        }

    def patterns(
        self,
        *,
        today: date | str | None = None,
        asset: str = "sp500",
    ) -> dict[str, Any]:
        """The v1 rolling 120-year comparison plus the v2 ``engine`` block.

        ``engine`` (closest historical setups, regime/patterns_v2.py) always
        describes the latest data, whatever ``today`` is. It is cached per
        asset and is None when it cannot be built, so it never fails the
        request; an unknown asset still raises ValueError from v1.
        """
        from regime.patterns import build_patterns_payload

        frame = self._load()
        payload = build_patterns_payload(
            frame,
            today=today,
            asset=asset,
        )
        payload["engine"] = self._patterns_engine(asset, frame)
        return payload

    def _patterns_skill_doc(self) -> tuple[Any, dict[str, Any] | None]:
        """(stamp, doc) of the skill artifact, re-read when its mtime or size changes."""
        try:
            stat = self.patterns_skill_path.stat()
            stamp: Any = (stat.st_mtime_ns, stat.st_size)
        except OSError:
            stamp = None
        with self._lock:
            cached = self._patterns_skill
        if cached is not None and cached[0] == stamp:
            return cached
        doc = (
            patterns_v2.load_skill_doc(self.patterns_skill_path)
            if stamp is not None
            else None
        )
        with self._lock:
            self._patterns_skill = (stamp, doc)
        return stamp, doc

    def _patterns_event_list(self) -> list[dict[str, Any]]:
        if self._patterns_events is None:
            self._patterns_events = patterns_v2.load_events(PATTERNS_EVENTS_PATH)
        return self._patterns_events

    def _patterns_engine(
        self,
        asset: str,
        frame: pd.DataFrame,
    ) -> dict[str, Any] | None:
        """The validated v2 engine block for ``asset``; None (logged) on any failure.

        Built outside the lock and stored under it, once per (asset, parquet
        mtime, metadata mtime, skill artifact stamp); ``_load()`` clears the
        cache when the parquet changes.
        """
        try:
            skill_stamp, skill_doc = self._patterns_skill_doc()
            with self._lock:
                key = (self._mtime, self._meta_mtime, skill_stamp)
                current = self._frame is frame
                data_version = self._meta.get("data_version")
                cached = self._patterns_engine_cache.get(asset)
            if current and cached is not None and cached[0] == key:
                return cached[1]
            engine = patterns_v2.build_engine_payload(
                frame,
                asset,
                skill_doc=skill_doc,
                events=self._patterns_event_list(),
                data_version=data_version,
            )
            # Validate here: a contract break must degrade to engine: null,
            # not fail response validation (a 500) in the router.
            PatternEngineV2.model_validate(engine)
            json.dumps(engine, allow_nan=False)
        except Exception:  # noqa: BLE001 - the v2 block must never fail the request
            logger.exception("Study of Patterns v2 engine unavailable for %s", asset)
            return None
        if current:
            with self._lock:
                self._patterns_engine_cache[asset] = (key, engine)
        return engine

    def forecast(self) -> dict[str, Any]:
        """30-day forward probability of a Disruptive macro regime.

        A lightweight logistic regression is fitted on the serialized V2
        features only. The target is ``regime_state == "disruptive"`` thirty
        calendar days after each observation. The model is cached until the
        parquet artifact changes.
        """
        frame = self._load()
        if self._forecast_cache is not None:
            return self._forecast_cache

        from sklearn.linear_model import LogisticRegression
        from sklearn.pipeline import make_pipeline
        from sklearn.preprocessing import StandardScaler

        feature_columns = ["fed_cross", "curve_cross", "sahm_alert"]
        missing = [
            column for column in feature_columns if column not in frame.columns
        ]
        if missing:
            raise ValueError(
                "Forecast features are missing from the artifact: "
                + ", ".join(missing)
            )

        data = frame[feature_columns + ["regime_state", "macro_strength"]].copy()
        data["sahm_alert"] = (
            data["sahm_alert"].astype("boolean").fillna(False).astype(float)
        )
        future_state = data["regime_state"].shift(-30)
        target = pd.Series(pd.NA, index=data.index, dtype="boolean")
        valid_future = future_state.notna()
        target.loc[valid_future] = future_state.loc[valid_future].eq(
            "disruptive"
        )
        data["disruptive_30d"] = target

        current_rows = data.dropna(subset=feature_columns)
        train = data.dropna(subset=feature_columns + ["disruptive_30d"])
        if current_rows.empty or len(train) < 250:
            raise ValueError("Not enough observations to fit the forecast model")

        current = current_rows.iloc[-1]
        X_train = train[feature_columns].astype(float)
        y_train = train["disruptive_30d"].astype(int)
        model = make_pipeline(
            StandardScaler(),
            LogisticRegression(
                max_iter=2000,
                solver="lbfgs",
                class_weight=None,
            ),
        )
        model.fit(X_train, y_train)
        probability = float(
            model.predict_proba(
                current[feature_columns].astype(float).to_frame().T
            )[0, 1]
        )
        probability = max(0.0, min(1.0, probability))
        classifier = model[-1]
        coefficients = {
            column: round(float(value), 6)
            for column, value in zip(feature_columns, classifier.coef_[0])
        }

        payload = {
            "as_of": current.name.date().isoformat(),
            "horizon_days": 30,
            "model": "logistic_regression_v2",
            "features": feature_columns,
            "training": {
                "start": train.index.min().date().isoformat(),
                "end": train.index.max().date().isoformat(),
                "observations": int(len(train)),
                "disruptive_base_rate": round(float(y_train.mean()), 4),
            },
            "current": {
                "as_of": current.name.date().isoformat(),
                "regime_state": _as_str(current.get("regime_state")),
                "macro_strength": _as_float(
                    current.get("macro_strength"), 2
                ),
                "features": {
                    "fed_cross": round(float(current["fed_cross"]), 6),
                    "curve_cross": round(float(current["curve_cross"]), 6),
                    "sahm_alert": bool(current["sahm_alert"]),
                },
            },
            "disruptive_probability": round(probability, 4),
            "risk_pct": round(probability * 100.0, 1),
            "coefficients": coefficients,
            "intercept": round(float(classifier.intercept_[0]), 6),
            "notes": [
                "Target is regime_state == disruptive 30 calendar days after each observation.",
                "Logistic regression uses standardized V2 features and is cached until the artifact changes.",
                "Macro-regime risk only; not a security-specific return forecast or investment advice.",
            ],
        }
        self._forecast_cache = payload
        return payload
