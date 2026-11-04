"""The deliberate write path: usage ingest and feedback."""

from __future__ import annotations

import json
import os
import re
from typing import Any

from fastapi import APIRouter, HTTPException, Request, Response

from .botfilter import is_bot
from .schema import PayloadTooLarge, ValidationError, load_schema, validate_batch
from .store import get_store

router = APIRouter(prefix="/usage", tags=["analytics"])
feedback_router = APIRouter(prefix="/feedback", tags=["feedback"])

ALLOWED_ORIGIN = "https://strikehike.com"
MAX_FEEDBACK = 2 * 1024
LINK_OR_EMAIL = re.compile(
    r"(https?://|www\.|\b[\w.+-]+@[\w-]+\.[\w.-]+\b|"
    r"\b[a-z0-9-]+\.(?:com|org|net|io|co|in|ai|dev|app|me|info|biz|xyz|site|online)\b)",
    re.IGNORECASE,
)


def _origin_ok(request: Request) -> bool:
    origin = request.headers.get("origin")
    return origin is None or origin == ALLOWED_ORIGIN


def _drop(request: Request, kind: str, count: int) -> None:
    get_store().record_drop(kind, count)


def _enabled() -> bool:
    return os.environ.get("ANALYTICS_INGEST_ENABLED", "0") == "1"


def _privacy_headers(request: Request) -> bool:
    return request.headers.get("sec-gpc") == "1" or request.headers.get("dnt") == "1"


@router.post("", status_code=204)
async def ingest(request: Request) -> Response:
    raw = await request.body()
    if len(raw) > int(load_schema()["limits"]["max_body_bytes"]):
        _drop(request, "size", 0)
        raise HTTPException(status_code=413, detail="Payload too large")
    if not _origin_ok(request):
        _drop(request, "origin", 0)
        raise HTTPException(status_code=403, detail="Forbidden")
    if _privacy_headers(request) or not _enabled():
        return Response(status_code=204)
    try:
        payload: Any = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        _drop(request, "schema", 0)
        raise HTTPException(status_code=422, detail="Invalid JSON") from exc

    count = len(payload.get("ev", [])) if isinstance(payload, dict) else 0
    if is_bot(request.headers.get("user-agent")):
        _drop(request, "bot", count)
        return Response(status_code=204)
    try:
        envelope, events, stripped, vis = validate_batch(payload, len(raw))
    except PayloadTooLarge as exc:
        _drop(request, "size", count)
        raise HTTPException(status_code=413, detail="Payload too large") from exc
    except ValidationError as exc:
        _drop(request, "schema", count)
        raise HTTPException(status_code=422, detail="Invalid event payload") from exc

    get_store().ingest(
        envelope,
        events,
        vis,
        request.headers.get("user-agent") or "",
        request.headers.get("x-sh-net") or "unknown",
        stripped_props=stripped,
    )
    return Response(status_code=204)


@feedback_router.post("", status_code=204)
async def feedback(request: Request) -> Response:
    raw = await request.body()
    if len(raw) > MAX_FEEDBACK:
        raise HTTPException(status_code=413, detail="Payload too large")
    if not _origin_ok(request):
        raise HTTPException(status_code=403, detail="Forbidden")
    if _privacy_headers(request) or not _enabled():
        return Response(status_code=204)
    try:
        payload: Any = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=422, detail="Invalid JSON") from exc
    if not isinstance(payload, dict):
        raise HTTPException(status_code=422, detail="Invalid feedback")
    if str(payload.get("website") or "").strip():
        return Response(status_code=204)
    message = payload.get("message")
    if not isinstance(message, str) or not 3 <= len(message) <= 1_000:
        raise HTTPException(status_code=422, detail="Message must be 3 to 1,000 characters")
    if LINK_OR_EMAIL.search(message):
        raise HTTPException(status_code=422, detail="email_or_url")
    path = str(payload.get("path") or "")[:128]
    app_version = str(payload.get("app_version") or "")[:7]
    stored = get_store().add_feedback(
        message,
        path,
        app_version,
        request.headers.get("x-sh-net") or "unknown",
    )
    if not stored:
        raise HTTPException(status_code=429, detail="feedback_rate_limited")
    return Response(status_code=204)
