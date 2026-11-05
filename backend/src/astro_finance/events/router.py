"""FastAPI routes for real scheduled events.

GET /api/v1/events/upcoming  five verified events per theme, theme-filterable
GET /api/v1/events/health    active bundle version, counts and created_at

The request path never calls the network.  The active bundle is resolved from
the ``current`` pointer written by the activation step, with a mtime cache in
``store.current_bundle_dir``.
"""

from __future__ import annotations

import sqlite3
from datetime import date, datetime, time, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, Response

from .models import (
    THEME_METADATA,
    THEME_ORDER,
    SCHEMA_VERSION,
    Theme,
    iso_utc,
    start_instant,
)
from .schemas import HealthResponse, ThemeUpcoming, UpcomingEvent, UpcomingResponse
from .store import (
    current_bundle_dir,
    empty_event_counts,
    event_counts,
    bundle_info,
    upcoming_by_theme,
    upcoming_totals_by_theme,
)

router = APIRouter(prefix="/events", tags=["events"])

UPCOMING_CACHE_CONTROL = "public, s-maxage=3600, stale-while-revalidate=86400"
HEALTH_CACHE_CONTROL = "public, s-maxage=60, stale-while-revalidate=300"
BUNDLE_UNAVAILABLE = "Active events bundle is unavailable."


def get_active_bundle() -> Path | None:
    """Process-wide pointer lookup; tests override this dependency."""

    return current_bundle_dir()


def get_today() -> date:
    return datetime.now(timezone.utc).date()


def start_utc_for(event: dict) -> str | None:
    """The event's UTC instant, or ``None`` when it is all-day."""

    start_time = event.get("start_time")
    if not start_time:
        return None
    instant = start_instant(
        date.fromisoformat(str(event["start_date"])),
        time.fromisoformat(str(start_time)),
        event.get("timezone"),
    )
    return iso_utc(instant) if instant else None


def parse_themes(value: str | None) -> list[Theme]:
    """Parse ``themes=Finance,Science``; empty means all five themes."""

    if value is None or not value.strip():
        return list(THEME_ORDER)
    selected: list[Theme] = []
    unknown: list[str] = []
    for raw in value.split(","):
        name = raw.strip()
        if not name:
            continue
        try:
            theme = Theme(name)
        except ValueError:
            unknown.append(name)
            continue
        if theme not in selected:
            selected.append(theme)
    if unknown:
        raise HTTPException(
            status_code=422,
            detail=f"Unknown theme(s): {', '.join(sorted(unknown))}",
        )
    if not selected:
        return list(THEME_ORDER)
    return [theme for theme in THEME_ORDER if theme in selected]


@router.get(
    "/upcoming",
    response_model=UpcomingResponse,
    summary="Verified upcoming events, five per theme by default",
    description=(
        "Returns real scheduled events from the active bundle only. Themes can "
        "be filtered with a comma-separated `themes` value; Natural Disasters "
        "is never schedulable and always returns an empty list. The list is "
        "ordered by start date, then start time. This endpoint never calls an "
        "upstream service."
    ),
)
def get_upcoming(
    response: Response,
    themes: str | None = Query(
        None,
        description="Comma-separated theme names; omit for all five.",
    ),
    limit_per_theme: int = Query(5, ge=1, le=50),
    horizon_days: int = Query(365, ge=1, le=730),
    bundle_dir: Path | None = Depends(get_active_bundle),
    today: date = Depends(get_today),
) -> UpcomingResponse:
    response.headers["Cache-Control"] = UPCOMING_CACHE_CONTROL
    selected = parse_themes(themes)

    if bundle_dir is None:
        # The empty state is always the full five-theme contract, even if the
        # caller passed a filter; it is the honest answer until activation.
        return UpcomingResponse(
            as_of=today,
            bundle_version=None,
            message="No active events bundle is available yet.",
            themes={
                theme.value: ThemeUpcoming(
                    schedulable=bool(THEME_METADATA[theme]["schedulable"]),
                    total_available=0,
                    events=[],
                )
                for theme in THEME_ORDER
            },
        )

    try:
        info = bundle_info(bundle_dir)
        rows = upcoming_by_theme(
            bundle_dir / "events.sqlite",
            [theme.value for theme in selected],
            limit_per_theme,
            today=today,
            horizon_days=horizon_days,
        )
        totals = upcoming_totals_by_theme(
            bundle_dir / "events.sqlite",
            [theme.value for theme in selected],
            today=today,
            horizon_days=horizon_days,
        )
    except (FileNotFoundError, sqlite3.Error, OSError, ValueError) as exc:
        raise HTTPException(status_code=503, detail=BUNDLE_UNAVAILABLE) from exc

    try:
        as_of = date.fromisoformat(str(info.get("as_of")))
    except (TypeError, ValueError):
        as_of = today

    theme_payload: dict[str, ThemeUpcoming] = {}
    for theme in selected:
        schedulable = bool(THEME_METADATA[theme]["schedulable"])
        events = rows.get(theme.value, []) if schedulable else []
        theme_payload[theme.value] = ThemeUpcoming(
            schedulable=schedulable,
            total_available=totals.get(theme.value, 0) if schedulable else 0,
            events=[
                UpcomingEvent(
                    event_id=str(event["event_id"]),
                    name=str(event["name"]),
                    theme=str(event["theme"]),
                    start_date=event["start_date"],
                    start_time=event.get("start_time"),
                    timezone=event.get("timezone"),
                    start_utc=start_utc_for(event),
                    all_day=bool(event["all_day"]),
                    status=str(event["status"]),
                    verification=str(event["verification"]),
                    source_url=str(event["source_url"]),
                    days_until=int(event["days_until"]),
                )
                for event in events
            ],
        )

    return UpcomingResponse(
        as_of=as_of,
        bundle_version=info.get("bundle_version"),
        themes=theme_payload,
    )


@router.get(
    "/health",
    response_model=HealthResponse,
    summary="Active events bundle health",
    description=(
        "Reports the active bundle version and created_at, plus the same "
        "theme × kind × status counts as the bundle manifest. Returns a null "
        "version and zero counts when no bundle has been activated."
    ),
)
def get_health(
    response: Response,
    bundle_dir: Path | None = Depends(get_active_bundle),
) -> HealthResponse:
    response.headers["Cache-Control"] = HEALTH_CACHE_CONTROL
    if bundle_dir is None:
        return HealthResponse(
            active_version=None,
            created_at=None,
            counts=empty_event_counts(),
            schema_version=SCHEMA_VERSION,
            message="No active events bundle is available yet.",
        )
    try:
        info = bundle_info(bundle_dir)
        counts = event_counts(bundle_dir / "events.sqlite")
    except (FileNotFoundError, sqlite3.Error, OSError, ValueError) as exc:
        raise HTTPException(status_code=503, detail=BUNDLE_UNAVAILABLE) from exc
    return HealthResponse(
        active_version=info.get("bundle_version"),
        created_at=info.get("created_at"),
        counts=counts,
        schema_version=int(info.get("schema_version", SCHEMA_VERSION)),
    )
