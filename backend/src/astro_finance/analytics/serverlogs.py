"""Aggregate the masked Caddy access log for one IST week."""

from __future__ import annotations

import gzip
import json
import re
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from typing import Any, Iterator
from urllib.parse import parse_qs, urlsplit
from zoneinfo import ZoneInfo

from .botfilter import is_bot
from .routes import CALENDAR_FEEDS, PAGE_ROUTES, calendar_feed, page_template
from .store import referrer_class

IST = ZoneInfo("Asia/Kolkata")
DEFAULT_LOG_DIR = Path("/app/data/caddy-logs")
LOG_PREFIX = "strikehike.access"
REFERRER_CLASSES = (
    "search",
    "ai_assistant",
    "community",
    "social",
    "calendar",
    "feed",
    "email",
    "share",
    "referral",
    "internal",
    "direct",
)
STATUS_CLASSES = ("2xx", "3xx", "4xx", "5xx")
STATIC_SUFFIX = re.compile(
    r"\.(?:png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf)$", re.IGNORECASE
)


def week_bounds(week: str) -> tuple[datetime, datetime]:
    """Monday 00:00 to next Monday 00:00 in IST for YYYY-Www."""
    try:
        year_text, number_text = week.split("-W", 1)
        start_date = date.fromisocalendar(int(year_text), int(number_text), 1)
    except (AttributeError, TypeError, ValueError) as exc:
        raise ValueError("week must be YYYY-Www") from exc
    start = datetime.combine(start_date, time.min, tzinfo=IST)
    return start, start + timedelta(days=7)


def _header(request: dict[str, Any], name: str) -> str:
    headers = request.get("headers") or {}
    if not isinstance(headers, dict):
        return ""
    for key, value in headers.items():
        if str(key).lower() != name.lower():
            continue
        if isinstance(value, list):
            return str(value[0]) if value else ""
        return str(value or "")
    return ""


def _request_path(record: dict[str, Any]) -> str:
    request = record.get("request") or {}
    uri = str(request.get("uri") or "")
    return uri.split("?", 1)[0] or "/"


def _request_medium(record: dict[str, Any]) -> str:
    request = record.get("request") or {}
    uri = str(request.get("uri") or "")
    query = uri.split("?", 1)[1] if "?" in uri else ""
    values = parse_qs(query).get("utm_medium") or []
    return str(values[0]).lower() if values else ""


def _referrer_host(record: dict[str, Any]) -> str:
    request = record.get("request") or {}
    referer = _header(request, "Referer")
    if not referer:
        return ""
    try:
        return (urlsplit(referer).hostname or "").lower()
    except ValueError:
        return ""


def _is_page_request(method: str, path: str) -> bool:
    if method.upper() != "GET":
        return False
    if path.startswith(("/_next/", "/api/", "/calendar/")):
        return False
    return not bool(STATIC_SUFFIX.search(path))


def _status_class(status: int) -> str | None:
    if 200 <= status <= 299:
        return "2xx"
    if 300 <= status <= 399:
        return "3xx"
    if 400 <= status <= 499:
        return "4xx"
    if 500 <= status <= 599:
        return "5xx"
    return None


def _timestamp(record: dict[str, Any]) -> datetime | None:
    raw = record.get("ts")
    try:
        return datetime.fromtimestamp(float(raw), tz=timezone.utc)
    except (TypeError, ValueError, OSError):
        return None


def _records(log_dir: Path) -> Iterator[dict[str, Any]]:
    if not log_dir.is_dir():
        return
    for path in sorted(log_dir.iterdir()):
        name = path.name
        if not name.startswith(LOG_PREFIX) or not path.is_file():
            continue
        if not (name.endswith(".log") or name.endswith(".gz")):
            continue
        opener = gzip.open if name.endswith(".gz") else open
        try:
            with opener(path, "rt", encoding="utf-8") as handle:
                for line in handle:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        record = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if isinstance(record, dict):
                        yield record
        except (OSError, UnicodeDecodeError):
            continue


def aggregate(log_dir: str | Path, week: str) -> dict[str, Any]:
    """Return only counts; no IP, masked IP, referrer host or user agent."""
    start, end = week_bounds(week)
    start_ts = start.timestamp()
    end_ts = end.timestamp()
    requests = 0
    status_counts = {key: 0 for key in STATUS_CLASSES}
    page_requests = {key: 0 for key in (*PAGE_ROUTES, "other")}
    referrers = {key: 0 for key in REFERRER_CLASSES}
    feeds: dict[str, dict[str, Any]] = {
        feed: {"fetches": 0, "networks": set()} for feed in CALENDAR_FEEDS
    }
    bot_requests = 0
    human_requests = 0
    not_found = 0

    for record in _records(Path(log_dir)):
        moment = _timestamp(record)
        if moment is None or not (start_ts <= moment.timestamp() < end_ts):
            continue
        request = record.get("request") or {}
        if not isinstance(request, dict):
            continue
        method = str(request.get("method") or "")
        path = _request_path(record)
        status = int(record.get("status") or 0)
        requests += 1
        status_key = _status_class(status)
        if status_key:
            status_counts[status_key] += 1
        if status == 404:
            not_found += 1

        user_agent = _header(request, "User-Agent")
        if is_bot(user_agent):
            bot_requests += 1
        else:
            human_requests += 1

        feed = calendar_feed(path)
        if feed:
            feeds[feed]["fetches"] += 1
            remote = str(request.get("remote_ip") or "")
            if remote:
                feeds[feed]["networks"].add(remote)

        if _is_page_request(method, path):
            page_requests[page_template(path)] += 1
            referrer = referrer_class(
                {
                    "referrer_host": _referrer_host(record),
                    "utm_medium": _request_medium(record),
                    "landing": 1,
                }
            )
            if referrer in referrers:
                referrers[referrer] += 1

    total = requests
    return {
        "week": week,
        "period": {
            "start": start.date().isoformat(),
            "end": (end.date() - timedelta(days=1)).isoformat(),
        },
        "requests": total,
        "status": status_counts,
        "page_requests": page_requests,
        "referrer_classes": referrers,
        "bot_share": round(100 * bot_requests / total, 1) if total else 0.0,
        "bot_requests": bot_requests,
        "human_requests": human_requests,
        "calendar_feeds": {
            feed: {
                "fetches": values["fetches"],
                "subscribers_approx": len(values["networks"]),
            }
            for feed, values in feeds.items()
        },
        "not_found": not_found,
    }
