"""FastAPI routes for the Convergence case catalogue.

GET /regime/cases                 every case, with coverage, kinds, pairs and recessions
GET /regime/cases/{case_id}/path  one aligned, sampled path from a case peak (or today)

Mounted by api_server.py under /api/v1, next to regime.router. Errors follow
regime.router: 503 when the artifact is missing, 404 for an unknown case id and
422 for a bad parameter or a series without data near day 0.
"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Response

from regime.case_schemas import CasePathResponse, CasesResponse
from regime.cases import ALLOWED_FROM_DAYS, CASE_ID_PATTERN, CaseStore, UnknownCaseError

router = APIRouter(prefix="/regime", tags=["regime"])
_store = CaseStore()

ARTIFACT_UNAVAILABLE = (
    "Macro regime artifact is not available. Run the Phase 1 "
    "ingestion pipeline and redeploy the backend."
)


def get_case_store() -> CaseStore:
    """The process-wide case store (tests override this dependency)."""
    return _store


@router.get(
    "/cases",
    response_model=CasesResponse,
    summary="Market declines found in the long-run artifact, for side-by-side comparison",
    description=(
        "Returns every case: a decline of at least the stated threshold on one "
        "market series (US stocks, Nifty 50, Bitcoin, gold, the Treasury model), "
        "with its peak, low and return to the peak as observation dates of that "
        "series, the Core Index and macro strength at the peak and the low, "
        "overlapping NBER recessions and dated events. Computed from the parquet "
        "and cached until it changes. Descriptive history, not a forecast."
    ),
)
def get_cases(store: CaseStore = Depends(get_case_store)) -> dict:
    try:
        return store.cases()
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=ARTIFACT_UNAVAILABLE) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get(
    "/cases/{case_id}/path",
    response_model=CasePathResponse,
    summary="One case's path in calendar days from its peak",
    description=(
        "Returns d (calendar days from day 0) and v (percent change from the "
        "base observation), with the Core Index (ci) and macro strength (ms) on "
        "the same dates. Day 0 is the case peak; for case_id=today it is the "
        "series' latest all-time high in its current era (align=peak) or its "
        "last observation (align=latest). Every point within two years of day 0 "
        "is kept, then weekly and monthly samples, up to 10,000 days; the case's "
        "low, recovery and lower low are always points of the path."
    ),
)
def get_case_path(
    case_id: str = Path(..., pattern=CASE_ID_PATTERN, description="A case id from /cases, or today."),
    series: Literal["own", "sp500", "gold", "bonds", "nifty", "bitcoin"] = Query(
        "own",
        description="own = the case's own series (sp500 for today).",
    ),
    from_days: int = Query(
        0,
        alias="from",
        description="0, -90, -365 or -730: calendar days before day 0 to include.",
    ),
    align: Literal["peak", "latest"] = Query(
        "peak",
        description="today only: peak = latest all-time high, latest = last observation.",
    ),
    store: CaseStore = Depends(get_case_store),
) -> Response:
    if from_days not in ALLOWED_FROM_DAYS:
        raise HTTPException(
            status_code=422,
            detail="from must be one of " + ", ".join(str(value) for value in ALLOWED_FROM_DAYS) + ".",
        )
    try:
        # The store caches the serialized payload (tests validate it against
        # CasePathResponse), so a cached path is sent without re-encoding.
        body = store.case_path_json(case_id, series=series, from_days=from_days, align=align)
        return Response(content=body, media_type="application/json")
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=ARTIFACT_UNAVAILABLE) from exc
    except UnknownCaseError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
