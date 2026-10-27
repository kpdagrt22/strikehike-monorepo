"""Rolling 120-year pattern comparison and one-year forward echo."""

from __future__ import annotations

import json
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

PATTERN_WINDOW_DAYS = 365
PATTERN_YEARS = 120
PATTERNS_VERSION = "patterns-v1"
PATTERNS_EVENTS_PATH = Path(__file__).with_name("patterns_events.json")
PATTERN_ASSETS = {
    "sp500": {
        "field": "sp500_proxy",
        "source_field": "sp500_proxy_source",
        "label": "S&P 500 / long-run equity proxy",
    },
    "nifty": {
        "field": "nifty_proxy",
        "source_field": "nifty_proxy_source",
        "label": "Nifty 50 — India",
    },
    "gold": {
        "field": "gold_proxy",
        "source_field": "gold_proxy_source",
        "label": "Gold — London bullion",
    },
    "bonds": {
        "field": "bond_proxy",
        "source_field": "bond_proxy_source",
        "label": "US Treasury bonds",
    },
    "bitcoin": {
        "field": "btc_proxy",
        "source_field": "btc_proxy_source",
        "label": "Bitcoin",
    },
}


def _as_utc_day(value: date | str | pd.Timestamp) -> pd.Timestamp:
    timestamp = pd.Timestamp(value)
    if timestamp.tzinfo is None:
        return timestamp.tz_localize("UTC")
    return timestamp.tz_convert("UTC")


def _shift_years(value: pd.Timestamp, years: int) -> pd.Timestamp:
    try:
        return value.replace(year=value.year + years)
    except ValueError:
        # 29 February on a non-leap target year.
        return value.replace(year=value.year + years, day=28)


def _price_window(
    frame: pd.DataFrame,
    end: pd.Timestamp,
    *,
    field: str = "sp500_proxy",
    days: int = PATTERN_WINDOW_DAYS,
) -> pd.Series:
    """Daily forward-filled target series over a fixed-length window."""
    if field not in frame.columns:
        return pd.Series(dtype="float64")
    index = pd.date_range(
        end=end,
        periods=days,
        freq="D",
    )
    series = pd.to_numeric(frame[field], errors="coerce")
    series = series.reindex(index).ffill().bfill()
    return series


def _last_value(
    frame: pd.DataFrame,
    column: str,
    end: pd.Timestamp,
) -> Any:
    if column not in frame.columns:
        return None
    series = frame[column].loc[:end].dropna()
    if series.empty:
        return None
    return series.iloc[-1]


def _trailing_summary(
    frame: pd.DataFrame,
    end: pd.Timestamp,
    *,
    field: str,
    source_field: str,
    asset_label: str,
) -> dict[str, Any]:
    series = _price_window(frame, end, field=field)
    values = series.dropna()
    if values.empty:
        raise ValueError(f"No {asset_label} history in the trailing window")
    first = float(values.iloc[0])
    last = float(values.iloc[-1])
    running_peak = values.cummax()
    drawdown = (values / running_peak - 1.0) * 100.0
    max_drawdown = float(drawdown.min()) if not drawdown.empty else None
    phase = _last_value(frame, "nber_phase", end)
    source = _last_value(frame, source_field, end)
    core_index = _last_value(frame, "core_index", end)
    core_bucket = _last_value(frame, "core_index_bucket", end)
    return_pct = ((last / first) - 1.0) * 100.0 if first > 0 else None
    phase_text = str(phase) if phase is not None and not pd.isna(phase) else "—"
    state = "Stable"
    if phase_text == "recession" or (
        max_drawdown is not None and max_drawdown <= -15
    ):
        state = "Contraction"
    elif return_pct is not None and return_pct > 20:
        state = "Strong expansion"
    elif return_pct is not None and return_pct > 3:
        state = "Expansion"
    elif return_pct is not None and return_pct < -3:
        state = "Contraction"

    points = [
        {
            "date": timestamp.date().isoformat(),
            "value": round(float(value), 4),
        }
        for timestamp, value in series.items()
        if pd.notna(value) and np.isfinite(float(value))
    ]
    return {
        "start": series.index.min().date().isoformat(),
        "end": series.index.max().date().isoformat(),
        "asset": asset_label,
        "source": None if source is None else str(source),
        "level": round(last, 4),
        "return_pct": round(return_pct, 2) if return_pct is not None else None,
        "drawdown_pct": round(max_drawdown, 2) if max_drawdown is not None else None,
        "phase": "Recession" if phase_text == "recession" else "Expansion",
        "state": state,
        "core_index": None if core_index is None or pd.isna(core_index) else round(float(core_index), 2),
        "core_index_bucket": None
        if core_bucket is None or pd.isna(core_bucket)
        else str(core_bucket),
        "series": points,
    }


def _forward_summary(
    frame: pd.DataFrame,
    start: pd.Timestamp,
    end: pd.Timestamp,
    *,
    field: str,
    asset_label: str,
) -> dict[str, Any]:
    if field not in frame.columns:
        raise ValueError(f"No {asset_label} history for the forward window")
    index = pd.date_range(start=start, end=end, freq="D")
    series = pd.to_numeric(frame[field], errors="coerce")
    series = series.reindex(index).ffill()
    values = series.dropna()
    if values.empty:
        raise ValueError(f"No {asset_label} history in the forward window")

    first = float(values.iloc[0])
    last = float(values.iloc[-1])
    peak_index = values.idxmax()
    peak_value = float(values.loc[peak_index])
    running_peak = values.cummax()
    drawdown = (values / running_peak - 1.0) * 100.0
    trough_index = drawdown.idxmin()
    trough_value = float(values.loc[trough_index])
    max_drawdown = float(drawdown.loc[trough_index])
    peak_before_trough_index = values.loc[:trough_index].idxmax()
    peak_before_trough_value = float(values.loc[peak_before_trough_index])
    return_pct = ((last / first) - 1.0) * 100.0 if first > 0 else None

    points = [
        {
            "date": timestamp.date().isoformat(),
            "value": round(float(value), 4),
        }
        for timestamp, value in series.items()
        if pd.notna(value) and np.isfinite(float(value))
    ]

    return {
        "start": start.date().isoformat(),
        "end": end.date().isoformat(),
        "asset": asset_label,
        "first_value": round(first, 4),
        "last_value": round(last, 4),
        "return_pct": round(return_pct, 2) if return_pct is not None else None,
        "peak": {
            "date": peak_index.date().isoformat(),
            "value": round(peak_value, 4),
        },
        "drawdown_peak": {
            "date": peak_before_trough_index.date().isoformat(),
            "value": round(peak_before_trough_value, 4),
        },
        "trough": {
            "date": trough_index.date().isoformat(),
            "value": round(trough_value, 4),
        },
        "max_drawdown_pct": round(max_drawdown, 2),
        "max_drawdown_from_peak": round(peak_before_trough_value, 4),
        "series": points,
    }


def _load_events() -> list[dict[str, Any]]:
    try:
        payload = json.loads(PATTERNS_EVENTS_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    if not isinstance(payload, list):
        return []
    return [
        item
        for item in payload
        if isinstance(item, dict)
        and isinstance(item.get("date"), str)
        and item.get("title")
    ]


def _events_in_window(
    start: pd.Timestamp,
    end: pd.Timestamp,
) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    for event in _load_events():
        try:
            event_date = _as_utc_day(event["date"])
        except (TypeError, ValueError):
            continue
        if start <= event_date <= end:
            events.append(
                {
                    "date": event_date.date().isoformat(),
                    "title": str(event["title"]),
                    "category": str(event.get("category") or "Historical"),
                    "summary": str(event.get("summary") or ""),
                    "source": str(event.get("source") or "Editorial dictionary"),
                }
            )
    events.sort(key=lambda item: item["date"])
    return events


def _pearson_similarity(
    current: pd.Series,
    historical: pd.Series,
) -> tuple[float, float]:
    current_values = current.dropna()
    historical_values = historical.dropna()
    size = min(len(current_values), len(historical_values))
    if size < 30:
        return 0.0, 0.0
    current_values = current_values.iloc[-size:].to_numpy(dtype="float64")
    historical_values = historical_values.iloc[-size:].to_numpy(dtype="float64")
    current_base = current_values[0]
    historical_base = historical_values[0]
    if (
        not np.isfinite(current_base)
        or not np.isfinite(historical_base)
        or current_base <= 0
        or historical_base <= 0
    ):
        return 0.0, 0.0
    current_scaled = current_values / current_base
    historical_scaled = historical_values / historical_base
    if np.std(current_scaled) == 0 or np.std(historical_scaled) == 0:
        return 0.0, 0.0
    correlation = float(np.corrcoef(current_scaled, historical_scaled)[0, 1])
    if not np.isfinite(correlation):
        correlation = 0.0
    similarity = max(0.0, min(1.0, correlation)) * 100.0
    return round(correlation, 4), round(similarity, 1)


def build_patterns_payload(
    frame: pd.DataFrame,
    *,
    today: date | str | pd.Timestamp | None = None,
    asset: str = "sp500",
) -> dict[str, Any]:
    """Build the rolling 120-year pattern comparison and forward echo."""
    if asset not in PATTERN_ASSETS:
        raise ValueError(f"Unknown pattern asset: {asset}")
    definition = PATTERN_ASSETS[asset]
    field = definition["field"]
    source_field = definition["source_field"]
    asset_label = definition["label"]
    if field not in frame.columns:
        raise ValueError(f"No {asset_label} history is available")
    first_valid = frame[field].first_valid_index()
    if first_valid is None:
        raise ValueError(f"No {asset_label} observations are available")

    today_timestamp = _as_utc_day(
        today or datetime.now(timezone.utc).date()
    )
    requested_then = _shift_years(today_timestamp, -PATTERN_YEARS)
    then_timestamp = requested_then
    mirror_fallback = False
    mirror_note = None
    if first_valid > then_timestamp:
        # Some assets (notably Nifty 50) do not reach back 120 years. Use the
        # earliest complete one-year analog instead of fabricating history.
        then_timestamp = first_valid + pd.Timedelta(days=PATTERN_WINDOW_DAYS)
        mirror_fallback = True
        mirror_note = (
            f"{asset_label} history begins on "
            f"{first_valid.date().isoformat()}; the closest available "
            "one-year mirror is used."
        )
    forward_end = _shift_years(then_timestamp, 1)

    current_window = _price_window(frame, today_timestamp, field=field)
    historical_window = _price_window(frame, then_timestamp, field=field)
    correlation, similarity = _pearson_similarity(
        current_window,
        historical_window,
    )
    current = _trailing_summary(
        frame,
        today_timestamp,
        field=field,
        source_field=source_field,
        asset_label=asset_label,
    )
    historical = _trailing_summary(
        frame,
        then_timestamp,
        field=field,
        source_field=source_field,
        asset_label=asset_label,
    )
    forward = _forward_summary(
        frame,
        then_timestamp,
        forward_end,
        field=field,
        asset_label=asset_label,
    )
    events = _events_in_window(then_timestamp, forward_end)

    return {
        "as_of": today_timestamp.date().isoformat(),
        "historical_date": then_timestamp.date().isoformat(),
        "requested_historical_date": requested_then.date().isoformat(),
        "mirror_fallback": mirror_fallback,
        "mirror_note": mirror_note,
        "asset": asset,
        "asset_label": asset_label,
        "forward_end": forward_end.date().isoformat(),
        "similarity_percentage": similarity,
        "correlation": correlation,
        "method": "pearson_correlation_normalized_price_365d",
        "window_days": PATTERN_WINDOW_DAYS,
        "current": current,
        "historical": historical,
        "forward": {
            **forward,
            "events": events,
        },
        "events": events,
        "notes": [
            "Current and historical windows are aligned by relative calendar day and rebased to their first observation.",
            "Similarity is the positive Pearson correlation of the normalized price paths, expressed as 0-100%.",
            "The forward window is the exact one-year period after the historical date; it is a historical echo, not a forecast.",
            "Events are a curated static dictionary for the 1906-1907 and 2008-2009 forward windows. This is an editorial archive, not a live news feed.",
        ],
    }
