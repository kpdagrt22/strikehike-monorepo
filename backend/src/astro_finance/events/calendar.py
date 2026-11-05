"""Hand-written RFC 5545 calendar feeds for the active events bundle."""

from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Iterable, Mapping

from .models import (
    THEME_ORDER,
    Theme,
    parse_utc,
    start_instant,
)

PRODID = "-//StrikeHike//Upcoming dates//EN"
SEQUENCE_EPOCH = datetime(2026, 1, 1, tzinfo=timezone.utc)
STATUS_MAP = {
    "scheduled": "CONFIRMED",
    "rescheduled": "CONFIRMED",
    "verified": "CONFIRMED",
    "tentative": "TENTATIVE",
    "cancelled": "CANCELLED",
}


def escape_text(value: str) -> str:
    """Escape RFC 5545 TEXT (backslash, semicolon, comma and newlines)."""

    return (
        value.replace("\\", "\\\\")
        .replace(";", "\\;")
        .replace(",", "\\,")
        .replace("\r\n", "\\n")
        .replace("\r", "\\n")
        .replace("\n", "\\n")
    )


def fold_line(line: str) -> bytes:
    """Encode one content line and fold it at 75 octets, never inside UTF-8."""

    data = line.encode("utf-8")
    if len(data) <= 75:
        return data
    chunks: list[bytes] = []
    start = 0
    first = True
    while start < len(data):
        limit = 75 if first else 74
        end = min(start + limit, len(data))
        # A UTF-8 continuation byte starts with 10xxxxxx. Move back until the
        # cut is on a character boundary.
        while end > start and end < len(data) and (data[end] & 0xC0) == 0x80:
            end -= 1
        prefix = b"" if first else b" "
        chunks.append(prefix + data[start:end])
        start = end
        first = False
    return b"\r\n".join(chunks)


def _lines(lines: Iterable[str]) -> bytes:
    return b"".join(fold_line(line) + b"\r\n" for line in lines)


def _format_utc(value: datetime) -> str:
    return value.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def _format_date(value: date) -> str:
    return value.strftime("%Y%m%d")


def _calendar_name(themes: list[Theme]) -> str:
    if list(themes) == list(THEME_ORDER):
        return "StrikeHike · Upcoming dates"
    return "StrikeHike · " + ", ".join(theme.value for theme in themes)


def _event_lines(event: Mapping[str, Any], stamp: str, sequence: int) -> list[str]:
    source = str(event["source_url"])
    method = "Method" if event.get("verification") == "computed" else "Source"
    description = (
        f"{event['theme']} · {method}: {source}\n"
        "Listed by StrikeHike. Dates only: StrikeHike does not say what will happen on them."
    )
    lines = ["BEGIN:VEVENT", f"UID:{event['event_id']}@strikehike.com"]
    lines.append(f"DTSTAMP:{stamp}")
    lines.append(f"LAST-MODIFIED:{stamp}")
    lines.append(f"SEQUENCE:{sequence}")

    if event.get("all_day"):
        start_date = date.fromisoformat(str(event["start_date"]))
        lines.append(f"DTSTART;VALUE=DATE:{_format_date(start_date)}")
        lines.append(f"DTEND;VALUE=DATE:{_format_date(start_date + timedelta(days=1))}")
    else:
        instant = start_instant(
            date.fromisoformat(str(event["start_date"])),
            time.fromisoformat(str(event["start_time"])),
            event.get("timezone"),
        )
        if instant is None:
            raise ValueError(f"timed event has no usable start: {event['event_id']}")
        lines.append(f"DTSTART:{_format_utc(instant)}")
        lines.append(f"DTEND:{_format_utc(instant + timedelta(minutes=30))}")

    lines.append(f"SUMMARY:{escape_text(str(event['name']))}")
    lines.append(f"DESCRIPTION:{escape_text(description)}")
    lines.append(f"URL:{source}")
    lines.append(f"STATUS:{STATUS_MAP.get(str(event['status']), 'CONFIRMED')}")
    lines.append("TRANSP:TRANSPARENT")
    lines.append("END:VEVENT")
    return lines


def build_calendar(
    events: Iterable[Mapping[str, Any]],
    themes: list[Theme],
    *,
    created_at: str | None,
) -> bytes:
    """Build a complete VCALENDAR; the same inputs always produce the same bytes."""

    stamp = (
        _format_utc(parse_utc(created_at))
        if created_at
        else _format_utc(datetime.now(timezone.utc))
    )
    if created_at:
        created = parse_utc(created_at)
        sequence = max(0, int((created - SEQUENCE_EPOCH).total_seconds() // 60))
    else:
        sequence = 0

    ordered = sorted(
        events,
        key=lambda event: (
            str(event["start_date"]),
            str(event.get("start_time") or "00:00:00"),
            str(event["event_id"]),
        ),
    )
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        f"PRODID:{PRODID}",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        f"X-WR-CALNAME:{escape_text(_calendar_name(themes))}",
        "X-WR-TIMEZONE:UTC",
        "REFRESH-INTERVAL;VALUE=DURATION:P1D",
        "X-PUBLISHED-TTL:P1D",
    ]
    for event in ordered:
        lines.extend(_event_lines(event, stamp, sequence))
    lines.append("END:VCALENDAR")
    return _lines(lines)
