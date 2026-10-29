"""FastAPI routes for Regime Intelligence."""

from __future__ import annotations

from datetime import date
from typing import Literal

from fastapi import APIRouter, HTTPException, Query

from regime.schemas import (
    CryptoMilestonesResponse,
    ForecastResponse,
    MacroHistoryResponse,
    PatternsResponse,
    RegimeRunsResponse,
)
from regime.service import MacroRegimeService

router = APIRouter(prefix="/regime", tags=["regime"])
patterns_router = APIRouter(prefix="/patterns", tags=["patterns"])
_service = MacroRegimeService()


@router.get(
    "/macro-history",
    response_model=MacroHistoryResponse,
    summary="Downsampled macro regime timeline and NBER crash windows",
    description=(
        "Returns the 0-100 macro strength meter, regime_state, "
        "1y_volatility_percentile, volatility_1y, drawdown_1y, the long-run "
        "equity proxy and USREC status, plus every NBER recession window with "
        "the yield curve and Fed Funds state 3 and 6 months before the peak. "
        "The default resolution is weekly for medium ranges and monthly for the "
        "full history; request daily for a short crash-zoom window. Use /runs "
        "for the transition matrix and median durations."
    ),
)
def get_macro_history(
    resolution: Literal["auto", "daily", "weekly", "monthly"] = Query(
        "auto",
        description="auto = daily up to 2 years, weekly up to 30 years, monthly beyond.",
    ),
    start: date | None = Query(None, description="Optional YYYY-MM-DD start."),
    end: date | None = Query(None, description="Optional YYYY-MM-DD end."),
) -> dict:
    try:
        return _service.macro_history(
            resolution=resolution,
            start=start,
            end=end,
        )
    except FileNotFoundError as exc:
        raise HTTPException(
            status_code=503,
            detail=(
                "Macro regime artifact is not available. Run the Phase 1 "
                "ingestion pipeline and redeploy the backend."
            ),
        ) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get(
    "/runs",
    response_model=RegimeRunsResponse,
    summary="Monthly regime runs, transition probabilities and median durations",
    description=(
        "Returns the full-coverage monthly regime runs with regime_state and "
        "1y_volatility_percentile, plus the 3x3 transition matrix and median "
        "duration for favorable, neutral and disruptive states. The frontend "
        "Transition Matrix can consume this without recalculating the history."
    ),
)
def get_regime_runs(
    start: date | None = Query(None, description="Optional YYYY-MM-DD start."),
    end: date | None = Query(None, description="Optional YYYY-MM-DD end."),
) -> dict:
    try:
        return _service.regime_runs(start=start, end=end)
    except FileNotFoundError as exc:
        raise HTTPException(
            status_code=503,
            detail=(
                "Macro regime artifact is not available. Run the Phase 1.5 "
                "ingestion pipeline and redeploy the backend."
            ),
        ) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get(
    "/crypto-milestones",
    response_model=CryptoMilestonesResponse,
    deprecated=True,
    summary="Editorial crypto event windows enriched with Core Index and asset returns",
    description=(
        "Returns the curated Bitcoin/crypto milestone windows (Genesis, Mt. Gox, "
        "ICO peak, Crypto Winter, COVID, Terra-LUNA and the spot ETF peak), "
        "each joined to peak-to-trough statistics for the S&P proxy, gold, "
        "Treasuries and Bitcoin plus the corresponding Core Index readings. "
        "Deprecated: the Convergence page uses /regime/cases."
    ),
)
def get_crypto_milestones() -> dict:
    try:
        return _service.crypto_milestones()
    except FileNotFoundError as exc:
        raise HTTPException(
            status_code=503,
            detail=(
                "Macro regime artifact is not available. Run the Phase 1 "
                "ingestion pipeline and redeploy the backend."
            ),
        ) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get(
    "/forecast",
    response_model=ForecastResponse,
    summary="30-day forward probability of a Disruptive macro regime",
    description=(
        "Trains/caches a lightweight logistic regression on the V2 Parquet "
        "features fed_cross, curve_cross and sahm_alert. The target is a "
        "Disruptive regime 30 calendar days after each observation. Returns "
        "the current probability and risk percentage for the top HUD."
    ),
)
def get_regime_forecast() -> dict:
    try:
        return _service.forecast()
    except FileNotFoundError as exc:
        raise HTTPException(
            status_code=503,
            detail=(
                "Macro regime artifact is not available. Run the Phase 1 "
                "ingestion pipeline and redeploy the backend."
            ),
        ) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@patterns_router.get(
    "",
    response_model=PatternsResponse,
    summary=(
        "Closest historical setups, what followed them, the usual year and "
        "the measured track record"
    ),
    description=(
        "The engine block (version patterns-v2) lists the past 12-month "
        "windows that most resemble the latest 12 months (weekly closes; "
        "monthly averages for gold), each at least one window apart, using "
        "only setups whose following 12 months ended before today's window "
        "began, and what followed each one. Counts sit beside the usual rate "
        "across all past years, never blended into a single figure. For the "
        "S&P 500 it adds the 120-year mirror on monthly averages since 1871. "
        "The walk-forward track record is precomputed offline and marked "
        "stale when the price inputs it was measured on change. engine is "
        "null if it cannot be built. The older top-level fields are unchanged "
        "for compatibility."
    ),
)
def get_patterns(
    asset: str = Query(
        "sp500",
        description="sp500, nifty, gold, bonds or bitcoin.",
    ),
) -> dict:
    try:
        return _service.patterns(asset=asset)
    except FileNotFoundError as exc:
        raise HTTPException(
            status_code=503,
            detail=(
                "Macro regime artifact is not available. Run the ingestion "
                "pipeline and redeploy the backend."
            ),
        ) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
