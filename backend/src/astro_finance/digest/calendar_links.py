"""Calendar links for the weekly email.

Every builder returns a plain URL. The Google and Outlook links carry UTC
instants; the email itself prints the IST time and, when the IST date differs,
the IST day beside it. No third-party logos are used.
"""

from __future__ import annotations

import re
from datetime import date, datetime, time, timedelta, timezone
from typing import Any
from urllib.parse import quote, urlencode
from zoneinfo import ZoneInfo

IST = ZoneInfo("Asia/Kolkata")
DISCLAIMER = "Descriptive context from StrikeHike, not investment advice."


def _parse_utc(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).astimezone(
            timezone.utc
        )
    except ValueError:
        return None


def item_instant(item: dict[str, Any]) -> datetime | None:
    """The item's UTC instant, or None for an all-day item."""

    for key in ("start_utc", "at"):
        moment = _parse_utc(item.get(key))
        if moment is not None:
            return moment
    start_date = item.get("start_date")
    start_time = item.get("start_time")
    if not start_date or not start_time:
        return None
    try:
        local = datetime.fromisoformat(f"{start_date}T{start_time}")
    except ValueError:
        return None
    zone = item.get("timezone")
    if zone:
        try:
            local = local.replace(tzinfo=ZoneInfo(str(zone)))
            return local.astimezone(timezone.utc)
        except (KeyError, ValueError):
            pass
    return local.replace(tzinfo=timezone.utc)


def item_all_day(item: dict[str, Any]) -> bool:
    return item_instant(item) is None


def item_date(item: dict[str, Any]) -> date | None:
    raw = item.get("start_date") or item.get("at") or ""
    try:
        return date.fromisoformat(str(raw)[:10])
    except ValueError:
        return None


def ist_date(item: dict[str, Any]) -> date | None:
    moment = item_instant(item)
    return moment.astimezone(IST).date() if moment else item_date(item)


def item_title(item: dict[str, Any]) -> str:
    return str(item.get("name") or item.get("label") or item.get("body") or "StrikeHike date")


def item_key(item: dict[str, Any]) -> str:
    """A short, stable slug used in the single-item calendar route."""

    raw = item.get("id")
    if raw:
        key = str(raw).lower().replace("_", "-")
    else:
        kind = str(item.get("kind") or "item").lower().replace("_", "-")
        body = str(item.get("body") or "").lower().replace("_", "-")
        at = str(item.get("at") or "")
        stamp = re.sub(r"[^0-9t]", "", at.replace("-", "").replace(":", ""))[:13]
        key = f"{kind}-{body}-{stamp}".lower()
    key = re.sub(r"[^a-z0-9._-]+", "-", key).strip("-")
    return key[:96] or "item"


def item_duration_minutes(item: dict[str, Any]) -> int:
    if item_all_day(item):
        return 0
    kind = str(item.get("kind") or "").lower()
    if "eclipse" in kind:
        return 15
    if item.get("id") or item.get("theme") in {"Finance", "Politics"}:
        return 30
    return 15


def _human(value: date) -> str:
    return f"{value.strftime('%a')} {value.day} {value.strftime('%b %Y')}"


def _page_url(item: dict[str, Any], base_url: str) -> str:
    path = str(item.get("path") or "")
    if path.startswith("http://") or path.startswith("https://"):
        return path
    if path.startswith("/"):
        return f"{base_url.rstrip('/')}{path}"
    return base_url.rstrip("/")


def _description(item: dict[str, Any], base_url: str) -> str:
    when = item_date(item)
    line = item_title(item)
    if when:
        line = f"{line} — {_human(when)}"
    return f"{line}\n{_page_url(item, base_url)}\n{DISCLAIMER}"


def page_url(item: dict[str, Any], base_url: str) -> str:
    return _page_url(item, base_url)


def item_description(item: dict[str, Any], base_url: str) -> str:
    return _description(item, base_url)


def _utc_stamp(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def _utc_iso(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def google_calendar_url(item: dict[str, Any], base_url: str) -> str:
    start = item_instant(item)
    if start is None:
        day = item_date(item)
        if day is None:
            dates = ""
        else:
            dates = f"{day:%Y%m%d}/{(day + timedelta(days=1)):%Y%m%d}"
    else:
        end = start + timedelta(minutes=item_duration_minutes(item) or 30)
        dates = f"{_utc_stamp(start)}/{_utc_stamp(end)}"
    query = urlencode(
        {
            "action": "TEMPLATE",
            "text": f"{item_title(item)} · StrikeHike",
            "dates": dates,
            "details": _description(item, base_url),
            "location": _page_url(item, base_url),
        },
        quote_via=quote,
        safe="",
    )
    return f"https://calendar.google.com/calendar/render?{query}"


def outlook_calendar_url(item: dict[str, Any], base_url: str) -> str:
    start = item_instant(item)
    all_day = start is None
    if all_day:
        day = item_date(item) or date.today()
        start_iso = f"{day:%Y-%m-%d}T00:00:00Z"
        end_iso = f"{(day + timedelta(days=1)):%Y-%m-%d}T00:00:00Z"
    else:
        end = start + timedelta(minutes=item_duration_minutes(item) or 30)
        start_iso = _utc_iso(start)
        end_iso = _utc_iso(end)
    query = urlencode(
        {
            "subject": f"{item_title(item)} · StrikeHike",
            "startdt": start_iso,
            "enddt": end_iso,
            "body": _description(item, base_url),
            "allday": "true" if all_day else "false",
        },
        quote_via=quote,
        safe="",
    )
    return f"https://outlook.live.com/calendar/0/action/compose?{query}"


def ics_url(item: dict[str, Any], week: str, base_url: str) -> str:
    path = str(item.get("path") or "")
    if path.startswith("/events/"):
        slug = path.rstrip("/").rsplit("/", 1)[-1]
        return f"{base_url.rstrip('/')}/calendar/event/{slug}.ics"
    return (
        f"{base_url.rstrip('/')}/this-week/{week}/calendar/"
        f"{item_key(item)}.ics"
    )


def week_calendar_url(week: str, base_url: str) -> str:
    return f"{base_url.rstrip('/')}/this-week/{week}/calendar.ics"


def subscribe_url(base_url: str) -> str:
    return f"webcal://{base_url.replace('https://', '').replace('http://', '').rstrip('/')}/calendar/all.ics"


def google_subscribe_url(base_url: str) -> str:
    return (
        "https://calendar.google.com/calendar/r?cid="
        f"webcal://{base_url.replace('https://', '').replace('http://', '').rstrip('/')}/calendar/all.ics"
    )


def calendar_actions(
    item: dict[str, Any], week: str, base_url: str
) -> dict[str, str]:
    return {
        "google": google_calendar_url(item, base_url),
        "outlook": outlook_calendar_url(item, base_url),
        "ics": ics_url(item, week, base_url),
        "title": item_title(item),
        "key": item_key(item),
    }
