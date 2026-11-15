"""CSP violation reports: directive, blocked origin, page path and date only.

Two formats arrive: ``report-uri`` posts ``{"csp-report": {...}}`` as
``application/csp-report``; ``report-to`` posts an array of report objects. The
endpoint stores only the directive, the blocked resource's origin (never the
full URL), the page path without its query, and the date. It never reads the
user agent, cookies, Authorization or the client IP; there is no column for
them.
"""

from __future__ import annotations

import json
import os
from typing import Any
from urllib.parse import urlsplit

from fastapi import APIRouter, HTTPException, Request, Response
from starlette.concurrency import run_in_threadpool

from .store import get_store

router = APIRouter(prefix="/csp-report", tags=["csp"])
MAX_BODY = 8 * 1024
MAX_ITEMS = 10
ALLOWED_ORIGIN = "https://strikehike.com"
TOKEN_ORIGINS = {"inline", "eval", "self", "data", "blob", "wasm-eval"}


def _enabled() -> bool:
    return os.environ.get("ANALYTICS_INGEST_ENABLED", "0") == "1"


def _origin_ok(request: Request) -> bool:
    origin = request.headers.get("origin")
    return origin is None or origin == ALLOWED_ORIGIN


def _page_path(value: Any) -> str:
    if not isinstance(value, str) or not value:
        return ""
    try:
        parts = urlsplit(value)
    except ValueError:
        return ""
    if parts.scheme not in {"http", "https"}:
        return ""
    host = (parts.hostname or "").lower()
    if host not in {"strikehike.com", "www.strikehike.com"}:
        return ""
    return (parts.path or "/")[:160]


def _blocked_origin(value: Any) -> str:
    if not isinstance(value, str) or not value:
        return ""
    token = value.strip()
    if token in TOKEN_ORIGINS:
        return token
    try:
        parts = urlsplit(token)
    except ValueError:
        return ""
    if not parts.scheme or not parts.hostname:
        return ""
    return f"{parts.scheme}://{parts.hostname}".lower()[:160]


def _items(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, dict) and isinstance(payload.get("csp-report"), dict):
        return [payload["csp-report"]]
    if isinstance(payload, list):
        return [
            item["body"]
            for item in payload
            if isinstance(item, dict)
            and item.get("type") == "csp-violation"
            and isinstance(item.get("body"), dict)
        ]
    if isinstance(payload, dict) and "body" in payload:
        return [payload]
    return []


def _directive(item: dict[str, Any]) -> str:
    value = item.get("violated-directive") or item.get("effectiveDirective") or ""
    return str(value).split(" ")[0][:120]


def _document(item: dict[str, Any]) -> str:
    value = item.get("document-uri") or item.get("documentURL") or ""
    return _page_path(value)


def _blocked(item: dict[str, Any]) -> str:
    value = item.get("blocked-uri") or item.get("blockedURL") or ""
    return _blocked_origin(value)


@router.post("", status_code=204)
async def report(request: Request) -> Response:
    raw = await request.body()
    if len(raw) > MAX_BODY:
        raise HTTPException(status_code=413, detail="Payload too large")
    if not _origin_ok(request):
        raise HTTPException(status_code=403, detail="Forbidden")
    if not _enabled():
        return Response(status_code=204)
    try:
        payload: Any = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=422, detail="Invalid JSON") from exc

    items = _items(payload)
    if not items:
        return Response(status_code=204)

    store = get_store()
    net_key = request.headers.get("x-sh-net") or "unknown"
    for item in items[:MAX_ITEMS]:
        stored = await run_in_threadpool(
            store.add_csp_report,
            _directive(item),
            _blocked(item),
            _document(item),
            net_key,
        )
        if not stored:
            raise HTTPException(status_code=429, detail="csp_rate_limited")
    return Response(status_code=204)
