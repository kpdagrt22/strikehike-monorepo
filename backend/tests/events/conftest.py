"""Shared fixtures and builders for the events tests."""

from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path

import pytest

from astro_finance.events.models import (
    Event,
    EventKind,
    EventStatus,
    Reliability,
    SourceKind,
    SourceRun,
    Theme,
    Verification,
    make_event,
)
from astro_finance.events.registry import ReleaseSpec, SourceSpec

TODAY = date(2026, 11, 3)
NOW = datetime(2026, 11, 3, 12, 0, tzinfo=timezone.utc)
FIXTURES = Path(__file__).resolve().parent / "fixtures"


def build_event(
    *,
    event_id: str = "science:test:test-event-2027",
    name: str = "Test event",
    theme: Theme = Theme.SCIENCE,
    kind: EventKind = EventKind.UPCOMING,
    start_date: date | None = None,
    start_time: time | None = None,
    timezone_name: str | None = None,
    all_day: bool = True,
    status: EventStatus = EventStatus.SCHEDULED,
    description: str = "A test event.",
    source_id: str = "test_source",
    external_id: str | None = None,
    source_url: str = "https://example.com/event",
    verification: Verification = Verification.VERIFIED,
    supersedes: str | None = None,
    first: datetime = NOW,
    last: datetime = NOW,
    collected: datetime = NOW,
    days_until: int | None = None,
    missing_runs: int = 0,
) -> Event:
    if start_date is None:
        start_date = TODAY + timedelta(days=30) if kind is EventKind.UPCOMING else date(2020, 1, 1)
    if kind is EventKind.HISTORICAL:
        all_day = True
        start_time = None
        timezone_name = None
        status = EventStatus.COMPLETED
    return make_event(
        event_id=event_id,
        name=name,
        theme=theme,
        kind=kind,
        start_date=start_date,
        start_time=start_time,
        timezone=timezone_name,
        all_day=all_day,
        status=status,
        description=description,
        source_id=source_id,
        external_id=external_id,
        source_url=source_url,
        first_discovered_at=first,
        last_updated_at=last,
        collected_at=collected,
        verification=verification,
        supersedes=supersedes,
        days_until=days_until,
        missing_runs=missing_runs,
    )


def build_source(
    *,
    source_id: str = "test_source",
    themes: tuple[Theme, ...] = (Theme.SCIENCE,),
    kind: SourceKind = SourceKind.API,
    verification: Verification = Verification.VERIFIED,
    reliability: Reliability = Reliability.HIGH,
    freshness: int = 7,
    url: str = "https://example.com/source",
    releases: tuple[ReleaseSpec, ...] = (),
) -> SourceSpec:
    return SourceSpec(
        id=source_id,
        themes=themes,
        kind=kind,
        url=url,
        terms="test",
        rate_limit="none",
        expected_freshness_days=freshness,
        reliability=reliability,
        enabled=True,
        verification=verification,
        releases=releases,
    )


def build_run(
    source_id: str = "test_source",
    *,
    fetched: bool = True,
    fetched_at: datetime | None = NOW,
    last_success: datetime | None = NOW,
    records: int = 1,
    rejected: int = 0,
    error: str | None = None,
) -> SourceRun:
    return SourceRun(
        source_id=source_id,
        fetched_this_run=fetched,
        fetched_at=fetched_at,
        last_success_at=last_success,
        record_count=records,
        rejected_count=rejected,
        error=error,
    )


@pytest.fixture
def today() -> date:
    return TODAY


@pytest.fixture
def now() -> datetime:
    return NOW


@pytest.fixture
def fixtures_dir() -> Path:
    return FIXTURES
