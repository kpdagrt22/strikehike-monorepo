"""HTTP routes for approved-roundup calendar files."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Response

from astro_finance.digest.content import (
    WEEK_RE,
    RoundupError,
    RoundupNotFound,
    fetch_roundup,
)
from astro_finance.digest.settings import base_url

from .calendar import build_item_calendar, build_week_calendar

router = APIRouter(prefix="/roundups", tags=["roundups"])
CACHE = "public, max-age=31536000, immutable"


def _load(week: str) -> dict:
    if not WEEK_RE.match(week or ""):
        raise HTTPException(status_code=404, detail="No approved roundup for this week.")
    try:
        return fetch_roundup(week)
    except RoundupNotFound as exc:
        raise HTTPException(
            status_code=404, detail="No approved roundup for this week."
        ) from exc
    except RoundupError as exc:
        raise HTTPException(
            status_code=503, detail="The roundup route is unavailable."
        ) from exc


def _etag(roundup: dict) -> str:
    return f'"{roundup.get("week")}-{roundup.get("generated_at")}"'


@router.get("/{week}/calendar.ics")
def week_calendar(week: str) -> Response:
    roundup = _load(week)
    body = build_week_calendar(roundup, base_url())
    return Response(
        content=body,
        headers={
            "Content-Type": "text/calendar; charset=utf-8",
            "Content-Disposition": f'attachment; filename="strikehike-{week}.ics"',
            "Cache-Control": CACHE,
            "ETag": _etag(roundup),
        },
    )


@router.get("/{week}/calendar/{item}.ics")
def item_calendar(week: str, item: str) -> Response:
    roundup = _load(week)
    key = item[:-4] if item.endswith(".ics") else item
    body = build_item_calendar(roundup, base_url(), key)
    if body is None:
        raise HTTPException(status_code=404, detail="No such item in this week.")
    return Response(
        content=body,
        headers={
            "Content-Type": "text/calendar; charset=utf-8",
            "Content-Disposition": (
                f'attachment; filename="strikehike-{week}-{key}.ics"'
            ),
            "Cache-Control": CACHE,
            "ETag": _etag(roundup),
        },
    )
