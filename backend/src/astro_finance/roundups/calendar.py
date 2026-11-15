"""Approved-roundup calendar files for the weekly email."""

from __future__ import annotations

from typing import Any

from astro_finance.digest.calendar_links import (
    item_all_day,
    item_description,
    item_duration_minutes,
    item_instant,
    item_key,
    item_title,
    page_url,
)
from astro_finance.events.calendar import (
    build_event_calendar,
    build_roundup_calendar,
)


def _event_item(
    item: dict[str, Any], week: str, base_url: str, theme: str | None = None
) -> dict[str, Any]:
    instant = item_instant(item)
    if instant is not None:
        day = instant.date().isoformat()
        clock = instant.strftime("%H:%M:%S")
        zone = "UTC"
    else:
        day = str(item.get("start_date") or "")
        clock = item.get("start_time")
        zone = item.get("timezone") or "UTC"
    if not day:
        raise ValueError("roundup item has no date")
    kind = str(item.get("kind") or "")
    item_theme = theme or item.get("theme")
    if not item_theme:
        item_id = str(item.get("id") or "")
        item_theme = (
            "Science"
            if item_id.startswith("science:") or kind
            else "Finance"
        )
    return {
        "event_id": f"{week}-{item_key(item)}",
        "name": item_title(item),
        "theme": item_theme,
        "start_date": day,
        "start_time": clock,
        "timezone": zone,
        "all_day": item_all_day(item),
        "duration_minutes": item_duration_minutes(item),
        "status": "scheduled",
        "verification": "computed" if kind else "sourced",
        "source_url": page_url(item, base_url),
        "calendar_url": page_url(item, base_url),
        "calendar_description": item_description(item, base_url),
        "path": item.get("path"),
        "kind": kind,
    }


def roundup_items(roundup: dict[str, Any], base_url: str) -> list[dict[str, Any]]:
    week = str(roundup.get("week") or "")
    items: list[dict[str, Any]] = []
    for theme in roundup.get("themes") or []:
        for event in theme.get("events") or []:
            items.append(_event_item(event, week, base_url, theme.get("name")))
    for sky in roundup.get("sky_week_items") or roundup.get("sky") or []:
        items.append(_event_item(sky, week, base_url, "Science"))
    for event in roundup.get("next_two_weeks") or []:
        items.append(_event_item(event, week, base_url, event.get("theme")))
    return items


def build_week_calendar(roundup: dict[str, Any], base_url: str) -> bytes:
    week = str(roundup.get("week") or "")
    return build_roundup_calendar(
        roundup_items(roundup, base_url),
        created_at=roundup.get("generated_at"),
        calendar_name=f"StrikeHike · {week}",
    )


def find_item(
    roundup: dict[str, Any], base_url: str, key: str
) -> dict[str, Any] | None:
    for item in roundup_items(roundup, base_url):
        if item["event_id"].endswith(f"-{key}") or item_key(item) == key:
            return item
    return None


def build_item_calendar(
    roundup: dict[str, Any], base_url: str, key: str
) -> bytes | None:
    item = find_item(roundup, base_url, key)
    if item is None:
        return None
    return build_event_calendar(item, created_at=roundup.get("generated_at"))
