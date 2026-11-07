"""Typed domain models for the weekly events pipeline.

The models are frozen dataclasses so that a stage can hand records to the next
stage without defensive copying.  Every timestamp is timezone-aware UTC; the
bundle serialises dates and times as ISO 8601 strings.  ``content_hash`` covers
only editorial content, never run timestamps, so the bundle version is stable
when the facts have not changed.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, replace
from datetime import date, datetime, time, timezone
from enum import Enum
from typing import Any, Iterable, Mapping
from zoneinfo import ZoneInfo


SCHEMA_VERSION = 1

# The public event-id grammar, ``<theme-slug>:<source-id>:<fragment>``: the same
# pattern analytics/schema.json enforces for ``event_id``.  Archived snapshot
# ids (``@`` and ``~``) never match, so they are not addressable on their own.
# The length cap is wider than the analytics one: curated historical ids reach
# 77 characters.
EVENT_ID_PATTERN = r"^[a-z-]+:[a-z0-9_-]+:[A-Za-z0-9:._-]+$"
EVENT_ID_MAX_LENGTH = 160


class Theme(str, Enum):
    """The five themes shared with the existing historical dataset."""

    POLITICS = "Politics"
    SCIENCE = "Science"
    FINANCE = "Finance"
    CULTURE_RELIGION = "Culture/Religion"
    NATURAL_DISASTERS = "Natural Disasters"

    @property
    def slug(self) -> str:
        return THEME_SLUGS[self]

    @classmethod
    def from_value(cls, value: str) -> "Theme":
        try:
            return cls(value)
        except ValueError as exc:
            raise ValueError(f"unknown theme: {value!r}") from exc


THEME_SLUGS: Mapping[Theme, str] = {
    Theme.POLITICS: "politics",
    Theme.SCIENCE: "science",
    Theme.FINANCE: "finance",
    Theme.CULTURE_RELIGION: "culture-religion",
    Theme.NATURAL_DISASTERS: "natural-disasters",
}

THEME_ORDER: tuple[Theme, ...] = (
    Theme.POLITICS,
    Theme.SCIENCE,
    Theme.FINANCE,
    Theme.CULTURE_RELIGION,
    Theme.NATURAL_DISASTERS,
)

THEME_METADATA: Mapping[Theme, Mapping[str, Any]] = {
    Theme.POLITICS: {"schedulable": True},
    Theme.SCIENCE: {"schedulable": True},
    Theme.FINANCE: {"schedulable": True},
    Theme.CULTURE_RELIGION: {"schedulable": True},
    Theme.NATURAL_DISASTERS: {
        "schedulable": False,
        "reason": (
            "Natural disasters cannot be scheduled; this theme shows history only."
        ),
    },
}


class EventKind(str, Enum):
    HISTORICAL = "historical"
    UPCOMING = "upcoming"


class EventStatus(str, Enum):
    SCHEDULED = "scheduled"
    TENTATIVE = "tentative"
    RESCHEDULED = "rescheduled"
    CANCELLED = "cancelled"
    COMPLETED = "completed"
    UNVERIFIED = "unverified"


class Verification(str, Enum):
    VERIFIED = "verified"
    COMPUTED = "computed"
    CURATED = "curated"
    UNVERIFIED = "unverified"


class SourceKind(str, Enum):
    API = "api"
    COMPUTED = "computed"
    CURATED = "curated"
    HISTORICAL = "historical"


class Reliability(str, Enum):
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


RELIABILITY_RANK: Mapping[Reliability, int] = {
    Reliability.HIGH: 3,
    Reliability.MEDIUM: 2,
    Reliability.LOW: 1,
}

VERIFICATION_RANK: Mapping[Verification, int] = {
    Verification.VERIFIED: 4,
    Verification.COMPUTED: 3,
    Verification.CURATED: 2,
    Verification.UNVERIFIED: 1,
}


def utc_now() -> datetime:
    """Return the current UTC time; callers may inject a fixed value in tests."""

    return datetime.now(timezone.utc)


def iso_utc(value: datetime) -> str:
    """Serialise a UTC datetime as ISO 8601 with a trailing ``Z``."""

    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def parse_utc(value: str) -> datetime:
    """Parse an ISO 8601 timestamp and require an explicit UTC offset."""

    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("timestamp must include a UTC offset")
    return parsed.astimezone(timezone.utc)


def start_instant(
    start_date: date,
    start_time: time | None,
    timezone_name: str | None,
) -> datetime | None:
    """The UTC instant of a timed event, or ``None`` for an all-day event.

    ``ZoneInfo`` applies the zone's daylight-saving rules for that date, so an
    08:30 New York release is 13:30Z in winter and 12:30Z in summer.
    """

    if start_time is None or not timezone_name:
        return None
    local = datetime.combine(start_date, start_time, tzinfo=ZoneInfo(timezone_name))
    return local.astimezone(timezone.utc)


def canonical_json(payload: Any) -> str:
    """Stable JSON used for hashing: sorted keys, compact, UTF-8 friendly."""

    return json.dumps(
        payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    )


def sha256_hex(payload: str | bytes) -> str:
    data = payload.encode("utf-8") if isinstance(payload, str) else payload
    return hashlib.sha256(data).hexdigest()


@dataclass(frozen=True, slots=True)
class Event:
    """One event in the bundle.

    ``missing_runs`` is internal lifecycle state: the number of consecutive
    successful runs in which an enabled source did not return the event.  It is
    kept in the bundle so the rule survives between weekly runs.
    """

    event_id: str
    name: str
    theme: Theme
    kind: EventKind
    start_date: date
    start_time: time | None
    timezone: str | None
    all_day: bool
    status: EventStatus
    description: str
    source_id: str
    external_id: str | None
    source_url: str
    first_discovered_at: datetime
    last_updated_at: datetime
    collected_at: datetime
    verification: Verification
    supersedes: str | None
    content_hash: str
    days_until: int | None = None
    missing_runs: int = 0
    # A page that names this specific event (events/authority.py). Optional.
    authority_url: str | None = None

    def content_dict(self) -> dict[str, Any]:
        """Fields that define the event's content, excluding run state.

        ``authority_url`` is included only when set, so every event without
        one keeps the content hash (and bundle version) it had before the
        field existed.
        """

        payload: dict[str, Any] = {
            "event_id": self.event_id,
            "name": self.name,
            "theme": self.theme.value,
            "kind": self.kind.value,
            "start_date": self.start_date.isoformat(),
            "start_time": self.start_time.isoformat() if self.start_time else None,
            "timezone": self.timezone,
            "all_day": self.all_day,
            "status": self.status.value,
            "description": self.description,
            "source_id": self.source_id,
            "external_id": self.external_id,
            "source_url": self.source_url,
            "verification": self.verification.value,
            "supersedes": self.supersedes,
        }
        if self.authority_url:
            payload["authority_url"] = self.authority_url
        return payload

    def to_dict(self) -> dict[str, Any]:
        """Stable key order for ``events.json`` and the read API."""

        payload = self.content_dict()
        payload.update(
            {
                "first_discovered_at": iso_utc(self.first_discovered_at),
                "last_updated_at": iso_utc(self.last_updated_at),
                "collected_at": iso_utc(self.collected_at),
                "content_hash": self.content_hash,
                "days_until": self.days_until,
                "missing_runs": self.missing_runs,
            }
        )
        return payload

    @classmethod
    def from_dict(cls, payload: Mapping[str, Any]) -> "Event":
        start_time = payload.get("start_time")
        return cls(
            event_id=str(payload["event_id"]),
            name=str(payload["name"]),
            theme=Theme(str(payload["theme"])),
            kind=EventKind(str(payload["kind"])),
            start_date=date.fromisoformat(str(payload["start_date"])),
            start_time=time.fromisoformat(str(start_time)) if start_time else None,
            timezone=payload.get("timezone"),
            all_day=bool(payload["all_day"]),
            status=EventStatus(str(payload["status"])),
            description=str(payload.get("description", "")),
            source_id=str(payload["source_id"]),
            external_id=payload.get("external_id"),
            source_url=str(payload["source_url"]),
            first_discovered_at=parse_utc(str(payload["first_discovered_at"])),
            last_updated_at=parse_utc(str(payload["last_updated_at"])),
            collected_at=parse_utc(str(payload["collected_at"])),
            verification=Verification(str(payload["verification"])),
            supersedes=payload.get("supersedes"),
            content_hash=str(payload.get("content_hash") or ""),
            days_until=payload.get("days_until"),
            missing_runs=int(payload.get("missing_runs") or 0),
            authority_url=payload.get("authority_url") or None,
        )


def with_content_hash(event: Event) -> Event:
    """Return the event with a hash that matches its current content."""

    digest = sha256_hex(canonical_json(event.content_dict()))
    if digest == event.content_hash:
        return event
    return replace(event, content_hash=digest)


def make_event(**payload: Any) -> Event:
    """Construct an event and fill in its content hash."""

    return with_content_hash(Event(content_hash="", **payload))


def replace_event(event: Event, **changes: Any) -> Event:
    """Apply changes and always recompute the content hash."""

    return with_content_hash(replace(event, **changes))


@dataclass(frozen=True, slots=True)
class RawRecord:
    """A source-shaped record before normalisation.

    Keeping raw records separate from :class:`Event` means a source can never
    smuggle run timestamps or an id scheme into the canonical bundle.
    """

    source_id: str
    name: str
    theme: str
    start_date: str
    description: str = ""
    external_id: str | None = None
    start_time: str | None = None
    timezone: str | None = None
    all_day: bool = True
    status: str = EventStatus.SCHEDULED.value
    source_url: str | None = None
    verification: str | None = None
    kind: str = EventKind.UPCOMING.value
    supersedes: str | None = None
    authority_url: str | None = None


@dataclass(frozen=True, slots=True)
class StageRecord:
    execution_id: str
    stage: str
    started_at: datetime
    ended_at: datetime
    duration_ms: int
    status: str
    input_count: int
    output_count: int
    error: str | None
    retries: int
    data_version: str | None

    def to_dict(self) -> dict[str, Any]:
        return {
            "execution_id": self.execution_id,
            "stage": self.stage,
            "started_at": iso_utc(self.started_at),
            "ended_at": iso_utc(self.ended_at),
            "duration_ms": self.duration_ms,
            "status": self.status,
            "input_count": self.input_count,
            "output_count": self.output_count,
            "error": self.error,
            "retries": self.retries,
            "data_version": self.data_version,
        }


@dataclass(frozen=True, slots=True)
class SourceRun:
    """Freshness and volume information for one source in one run."""

    source_id: str
    fetched_this_run: bool
    fetched_at: datetime | None
    last_success_at: datetime | None
    record_count: int
    rejected_count: int
    error: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.source_id,
            "fetched_this_run": self.fetched_this_run,
            "fetched_at": iso_utc(self.fetched_at) if self.fetched_at else None,
            "last_success_at": (
                iso_utc(self.last_success_at) if self.last_success_at else None
            ),
            "record_count": self.record_count,
            "rejected_count": self.rejected_count,
            "error": self.error,
        }


def theme_sort_key(theme: Theme) -> int:
    return THEME_ORDER.index(theme)


def event_sort_key(event: Event) -> tuple[str, date, int, str]:
    """Canonical bundle order: kind, start date, theme, event id."""

    return (
        event.kind.value,
        event.start_date,
        theme_sort_key(event.theme),
        event.event_id,
    )


def sort_events(events: Iterable[Event]) -> list[Event]:
    return sorted(events, key=event_sort_key)
