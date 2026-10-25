from __future__ import annotations

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
import pandas as pd
import numpy as np
from pathlib import Path
from datetime import datetime
from typing import Annotated, Any
import joblib
import os
import sys
from pydantic import BaseModel

# Make the package importable when this file is run directly from the repo root.
SRC_DIR = Path(__file__).resolve().parent / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from astro_finance.energy_metric_compiler import (  # noqa: E402
    BODY_NAMES,
    EnergyMetricCompiler,
    planetary_intensity_from_row,
    rashi_nakshatra_pada,
)
from astro_finance.historical_parallels import (  # noqa: E402
    ensure_event_database,
    find_historical_parallels,
    forecast_ladder,
    list_events_by_category,
)

app = FastAPI(title="Astro-Finance API")

CORS_ORIGINS = [
    origin.strip()
    for origin in os.getenv(
        "CORS_ORIGINS",
        "http://localhost:3000,http://localhost:3001",
    ).split(",")
    if origin.strip()
]

# CORS for the Next.js frontend and direct browser probes.
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Legacy simulated WebSocket feed. The Phase 6 endpoints do not use it, and its
# five-second demo broadcast is intentionally off in production.
if os.getenv("ENABLE_LEGACY_WEBSOCKET", "0").lower() in {"1", "true", "yes", "on"}:
    try:
        from websocket_server import setup_websocket, start_background_tasks

        setup_websocket(app)
        print("[ok] Legacy WebSocket server enabled at /ws")
    except ImportError as e:
        print(f"[warn] WebSocket not available: {e}")

@app.on_event("startup")
async def startup():
    """Initialize WebSocket broadcasting on server start, when available."""
    task = globals().get("start_background_tasks")
    if task is None:
        return

    try:
        await task()
        print("[ok] Real-time broadcasting started")
    except Exception as e:
        print(f"[warn] WebSocket background task failed: {e}")

# Load Models and Data
DATA_DIR = Path("data/processed")
MODELS_DIR = Path("data/processed")

def load_data():
    """Loads the master dataset."""
    try:
        df = pd.read_csv(DATA_DIR / "final_data_with_regimes.csv", index_col=0, parse_dates=True)
        return df
    except Exception as e:
        print(f"Error loading data: {e}")
        return None

def load_models():
    """Load trained model artifacts only when explicitly requested.

    The Phase 6 endpoints consume the precomputed model-output frame, so loading
    heavy HMM/XGBoost artifacts at startup is unnecessary. It is also fragile on
    hosts whose Application Control policy blocks compiled sklearn extensions.
    Set LOAD_ML_MODELS=1 to opt in.
    """
    if os.getenv("LOAD_ML_MODELS", "0").lower() not in {"1", "true", "yes", "on"}:
        print("[info] ML model artifacts not loaded (set LOAD_ML_MODELS=1 to enable).")
        return {}

    models = {}
    try:
        models['hmm'] = joblib.load(MODELS_DIR / "hmm_model.joblib")
        models['xgboost'] = joblib.load(MODELS_DIR / "xgboost_model.joblib")
    except Exception as e:
        print(f"[warn] Error loading models: {e}")
    return models

# Global state (in production, use Redis/DB)
df_global = None
models_global = None
energy_compiler = None

@app.on_event("startup")
async def startup_event():
    global df_global, models_global, energy_compiler
    df_global = load_data()
    models_global = load_models()

    if df_global is not None and len(df_global) > 0:
        try:
            energy_compiler = EnergyMetricCompiler.from_dataframe(df_global)
            print("[ok] Energy metric compiler ready")
        except Exception as exc:
            energy_compiler = None
            print(f"[warn] Energy metric compiler unavailable: {exc}")

    try:
        event_count = ensure_event_database()
        print(f"[ok] Historical event database ready ({event_count} events)")
    except Exception as exc:
        print(f"[warn] Historical event database unavailable: {exc}")

    print("[ok] Data and Models Loaded")


def _row_for_date(date_str: str | None):
    """Return the row for an exact UTC date, or the latest row when date is omitted."""
    if df_global is None or df_global.empty:
        raise HTTPException(status_code=503, detail="Data not loaded")

    if not date_str:
        return df_global.iloc[-1]

    try:
        timestamp = pd.Timestamp(date_str)
    except (TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=400,
            detail="date must be a valid YYYY-MM-DD value",
        ) from exc

    index_tz = getattr(df_global.index, "tz", None)
    if index_tz is not None:
        timestamp = (
            timestamp.tz_localize(index_tz)
            if timestamp.tzinfo is None
            else timestamp.tz_convert(index_tz)
        )
    elif timestamp.tzinfo is not None:
        timestamp = timestamp.tz_localize(None)

    matches = df_global[df_global.index.normalize() == timestamp.normalize()]
    if matches.empty:
        first = df_global.index.min().date()
        last = df_global.index.max().date()
        raise HTTPException(
            status_code=404,
            detail=f"No row for {date_str}; available {first} to {last}.",
        )

    return matches.iloc[-1]


def _positions_from_row(row) -> dict:
    positions = {}

    for body in BODY_NAMES:
        raw_degree = row.get(f"{body}_Degree", 0.0)
        degree = 0.0 if pd.isna(raw_degree) else float(raw_degree) % 360
        info = rashi_nakshatra_pada(degree)

        raw_retro = row.get(f"{body}_Retrograde", 0)
        retro = bool(raw_retro) if not pd.isna(raw_retro) else False

        positions[body] = {
            "degree": round(degree, 4),
            "rashi": info["rashi"],
            "nakshatra": info["nakshatra"],
            "pada": info["pada"],
            "retrograde": retro,
        }

    return positions


def _regime_label(regime: int) -> str:
    # Calibrated from the training data: 2 = highest volatility/crash rate,
    # 1 = lowest, 0 = mixed middle.
    return {
        0: "Neutral/Consolidating",
        1: "Favorable/Positive",
        2: "Disruptive/Negative",
    }.get(regime, "Unknown")


@app.get("/api/v1/astro-positions")
def get_astro_positions(
    date: Annotated[
        str | None,
        Query(description="UTC date YYYY-MM-DD; defaults to the latest row."),
    ] = None,
):
    """Planetary positions plus the compiled 0-100 energy metric."""
    if df_global is None or df_global.empty:
        raise HTTPException(status_code=503, detail="Data not loaded")
    if energy_compiler is None:
        raise HTTPException(
            status_code=503,
            detail="Energy metric compiler is not available",
        )

    row = _row_for_date(date)
    energy = energy_compiler.compile_from_row(row)

    # The compiler keeps the canonical state string (e.g. "Disruptive/Negative").
    # The endpoint exposes the compact label as `polarity` and retains the full
    # canonical state alongside it.
    energy["state"] = energy["polarity"]
    energy["polarity"] = energy.pop("polarity_short")

    intensity = planetary_intensity_from_row(row)
    regime = int(row.get("Market_Regime", -1))

    return {
        "date": str(row.name.date()),
        "positions": _positions_from_row(row),
        "energy": energy,
        "model": {
            "regime": regime,
            "regime_label": _regime_label(regime),
            "volatility": round(float(row.get("Volatility", 0.0)), 6),
            "intensity": round(float(intensity), 4),
            "source": "HMM regime + 20-day volatility + malefic aspect intensity",
        },
    }

class HistoricalParallelsRequest(BaseModel):
    date: str
    datetime: str | None = None
    geometry: dict[str, Any] | None = None
    limit: int = 3


@app.post("/api/v1/historical-parallels")
def historical_parallels(payload: HistoricalParallelsRequest):
    """Return 2-3 historical events with similar geometry or energy score."""
    try:
        return find_historical_parallels(
            payload.date,
            geometry=payload.geometry,
            limit=payload.limit,
            target_datetime=payload.datetime,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail="Historical parallels service is unavailable",
        ) from exc


@app.get("/api/v1/historical-parallels")
def historical_parallels_get(
    date: Annotated[
        str,
        Query(description="Target date YYYY-MM-DD."),
    ],
    datetime_value: Annotated[
        str | None,
        Query(alias="datetime", description="Optional exact UTC minute YYYY-MM-DDTHH:MM."),
    ] = None,
    limit: Annotated[int, Query(ge=2, le=3)] = 3,
):
    """Convenience GET; geometry is computed from the target date/minute."""
    try:
        return find_historical_parallels(
            date,
            limit=limit,
            target_datetime=datetime_value,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail="Historical parallels service is unavailable",
        ) from exc


@app.get("/api/v1/forecast-ladder")
def forecast_ladder_get(
    days: Annotated[int, Query(ge=1, le=180)] = 180,
    threshold: Annotated[float, Query(ge=50, le=100)] = 85,
    limit: Annotated[int, Query(ge=1, le=3)] = 3,
):
    """Return the top upcoming geometric echoes in the next N days."""
    try:
        return forecast_ladder(days=days, threshold=threshold, limit=limit)
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail="Forecast ladder service is unavailable",
        ) from exc


@app.get("/api/v1/events")
def historical_events():
    """Return the curated event roster grouped into the five public categories."""
    try:
        return list_events_by_category()
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail="Historical events service is unavailable",
        ) from exc


class PredictionResponse(BaseModel):
    date: str
    predictions: dict
    current_state: dict
    crash_probability: dict

@app.get("/")
def root():
    return {"status": "Astro-Finance API Active", "version": "1.0"}

@app.get("/health")
def health_check():
    return {"status": "healthy", "service": "astro-finance-api"}

@app.get("/api/current-state")
def get_current_state():
    """Returns the most recent planetary state and predictions."""
    if df_global is None or len(df_global) == 0:
        raise HTTPException(status_code=503, detail="Data not loaded")
    
    # Get latest row
    latest = df_global.iloc[-1]
    
    # Extract planetary positions (sample)
    planetary_state = {
        "Sun": {
            "degree": float(latest.get("Sun_Degree", 0)),
            "rashi": str(latest.get("Sun_Rashi", "N/A")),
            "nakshatra": str(latest.get("Sun_Nakshatra", "N/A")),
            "retrograde": bool(latest.get("Sun_Retrograde", False))
        },
        "Moon": {
            "degree": float(latest.get("Moon_Degree", 0)),
            "rashi": str(latest.get("Moon_Rashi", "N/A")),
            "nakshatra": str(latest.get("Moon_Nakshatra", "N/A")),
        },
        "Saturn": {
            "degree": float(latest.get("Saturn_Degree", 0)),
            "rashi": str(latest.get("Saturn_Rashi", "N/A")),
            "retrograde": bool(latest.get("Saturn_Retrograde", False))
        }
    }
    
    # Dasha
    dasha_lord = str(latest.get("Dasha_Lord", "Unknown"))
    
    # Market State
    regime = int(latest.get("Market_Regime", -1))
    regime_labels = {0: "Consolidation", 1: "Bull", 2: "Bear"}
    
    # Multi-Horizon Targets (Actual vs Predicted would come from model inference)
    predictions = {
        "1W": float(latest.get("Target_1W", 0)),
        "1M": float(latest.get("Target_1M", 0)),
        "1Y": float(latest.get("Target_1Y", 0)),
        "3Y": float(latest.get("Target_3Y", 0))
    }
    
    # Crash Probabilities
    crash_prob = {
        "minor": int(latest.get("Crash_Minor", 0)),
        "major": int(latest.get("Crash_Major", 0))
    }
    
    return {
        "date": str(latest.name),
        "planetary_state": planetary_state,
        "dasha_lord": dasha_lord,
        "market_regime": regime_labels.get(regime, "Unknown"),
        "predictions": predictions,
        "crash_probability": crash_prob,
        "price": float(latest.get("Close", 0))
    }

@app.get("/api/historical")
def get_historical(limit: int = 100):
    """Returns historical data for charting."""
    if df_global is None:
        raise HTTPException(status_code=503, detail="Data not loaded")
    
    df_subset = df_global.tail(limit)
    
    # Prepare for frontend
    data = []
    for idx, row in df_subset.iterrows():
        data.append({
            "date": str(idx),
            "close": float(row.get("Close", 0)),
            "regime": int(row.get("Market_Regime", 0)),
            "crash_minor": int(row.get("Crash_Minor", 0)),
            "crash_major": int(row.get("Crash_Major", 0))
        })
    
    return {"data": data}

if __name__ == "__main__":
    import uvicorn
    
    # Include Gann Theory routes
    try:
        from astro_finance.api.gann_routes import setup_gann_routes
        setup_gann_routes(app)
        print("[ok] Gann Theory routes enabled")
        print("   - POST /api/v1/gann/fan - Gann Fan analysis")
        print("   - POST /api/v1/gann/square-of-9 - Square of 9 levels")
        print("   - GET /api/v1/gann/lunar-sentiment - Lunar phase data")
        print("   - GET /api/v1/astro-positions - Positions + energy metric")
        print("   - GET/POST /api/v1/historical-parallels - Historical event matches")
    except ImportError as e:
        print(f"[warn] Gann routes not available: {e}")
    
    uvicorn.run(app, host="0.0.0.0", port=8000)
