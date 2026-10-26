"""Read-only macro-regime service.

Loads the Phase 1 parquet artifact once, checks its mtime on every request, and
builds the downsampled timeline plus NBER crash objects for the API. The service
does not call FRED; ingestion is a separate offline pipeline.
"""

from __future__ import annotations

import json
import statistics
import threading
from datetime import date
from pathlib import Path
from typing import Any, Literal

import numpy as np
import pandas as pd

from regime.analytics import (
    STRENGTH_VERSION,
    STRENGTH_WEIGHTS,
    build_crashes,
)

BACKEND_DIR = Path(__file__).resolve().parents[1]
DEFAULT_ARTIFACT = BACKEND_DIR / "data" / "processed" / "macro_regime_history.parquet"
DEFAULT_META = BACKEND_DIR / "data" / "processed" / "macro_regime_history.meta.json"

Resolution = Literal["auto", "daily", "weekly", "monthly"]
REGIME_STATES = ("favorable", "neutral", "disruptive")


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
            "volatility_1y",
            "drawdown_1y",
            "1y_volatility_percentile",
            "sp500_proxy",
            "sp500_proxy_source",
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
    # A right-labelled weekly/monthly bucket can end after the last observation.
    return resampled.loc[: subset.index.max()]


def _timeline_points(frame: pd.DataFrame) -> list[dict[str, Any]]:
    points: list[dict[str, Any]] = []
    for timestamp, row in frame.iterrows():
        strength = _as_float(row.get("macro_strength"), 2)
        sp500 = _as_float(row.get("sp500_proxy"), 2)
        usrec = _as_int(row.get("nber_recession"))
        if strength is None and sp500 is None and usrec is None:
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
                "volatility_1y": _as_float(row.get("volatility_1y"), 2),
                "drawdown_1y": _as_float(row.get("drawdown_1y"), 2),
                "1y_volatility_percentile": _as_float(
                    row.get("1y_volatility_percentile"), 1
                ),
                "sp500_proxy": sp500,
                "proxy_source": _as_str(row.get("sp500_proxy_source")),
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


class MacroRegimeService:
    def __init__(
        self,
        artifact_path: Path | str = DEFAULT_ARTIFACT,
        meta_path: Path | str = DEFAULT_META,
    ) -> None:
        self.artifact_path = Path(artifact_path)
        self.meta_path = Path(meta_path)
        self._frame: pd.DataFrame | None = None
        self._meta: dict[str, Any] = {}
        self._crashes: list[dict[str, Any]] = []
        self._mtime: float | None = None
        self._meta_mtime: float | None = None
        self._cache: dict[tuple[str, str, str], dict[str, Any]] = {}
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
            return self._frame

    def _meta_payload(self, frame: pd.DataFrame) -> dict[str, Any]:
        proxy_sources = self._meta.get("proxy", {}).get("sources")
        if not proxy_sources:
            proxy_sources = _proxy_sources_from_frame(frame)
        strength = self._meta.get("strength", {})
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
            "proxy_sources": proxy_sources,
            "nber_source": self._meta.get("nber", {}).get("source", "USREC"),
            "transport": source.get("transport"),
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
