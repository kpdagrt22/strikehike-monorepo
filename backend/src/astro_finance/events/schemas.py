"""Pydantic v2 response models for the events API."""

from __future__ import annotations

from datetime import date
from typing import Any

from pydantic import BaseModel, Field


class UpcomingEvent(BaseModel):
    event_id: str
    name: str
    theme: str
    start_date: date
    start_time: str | None = None
    timezone: str | None = None
    all_day: bool
    status: str
    verification: str
    source_url: str
    days_until: int


class ThemeUpcoming(BaseModel):
    schedulable: bool
    total_available: int = Field(ge=0)
    events: list[UpcomingEvent] = Field(default_factory=list)


class UpcomingResponse(BaseModel):
    as_of: date
    bundle_version: str | None = None
    message: str | None = None
    themes: dict[str, ThemeUpcoming]


class HealthResponse(BaseModel):
    active_version: str | None = None
    created_at: str | None = None
    counts: dict[str, Any]
    schema_version: int
    message: str | None = None
