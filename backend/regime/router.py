"""FastAPI routes for Regime Intelligence."""

from __future__ import annotations

from datetime import date
from typing import Literal

from fastapi import APIRouter, HTTPException, Query

from regime.schemas import MacroHistoryResponse, RegimeRunsResponse
from regime.service import MacroRegimeService

router = APIRouter(prefix="/regime", tags=["regime"])
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
