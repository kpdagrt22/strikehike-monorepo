"""FastAPI routes for double opt-in and one-click unsubscribe.

All routes answer 404 unless ``DIGEST_ENABLED=1``. The subscribe response is
identical for new, pending, active and unsubscribed addresses.
"""

from __future__ import annotations

import json
import logging
import threading
import time
from urllib.parse import quote

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse, RedirectResponse
from starlette.concurrency import run_in_threadpool

from . import settings
from .mailer import Mail, ResendMailer
from .privacy import mask_email, normalise_email
from .render import render_confirmation
from .store import DigestStore, get_store
from .tokens import TokenError, sign_token, verify_token

router = APIRouter(prefix="/digest", tags=["digest"])
logger = logging.getLogger("astro_finance.digest")

MAX_BODY = 2 * 1024
ALLOWED_ORIGIN = "https://strikehike.com"

_mailer: ResendMailer | None = None
_mailer_lock = threading.Lock()


def get_mailer() -> ResendMailer:
    global _mailer
    with _mailer_lock:
        if _mailer is None:
            _mailer = ResendMailer(
                settings.resend_api_key(),
                settings.from_address(),
                settings.reply_to(),
            )
        return _mailer


def _require_enabled() -> None:
    if not settings.enabled():
        raise HTTPException(status_code=404, detail="Not found")


def _origin_ok(request: Request) -> bool:
    origin = request.headers.get("origin")
    return origin is None or origin == ALLOWED_ORIGIN


def _net_key(request: Request) -> str:
    return (
        request.headers.get("x-sh-net")
        or (request.client.host if request.client else "")
        or "unknown"
    )


def _accepted() -> JSONResponse:
    return JSONResponse(
        {"status": "check_inbox"},
        status_code=202,
        headers={"Cache-Control": "no-store"},
    )


def _redirect(path: str) -> RedirectResponse:
    return RedirectResponse(
        f"{settings.base_url()}{path}",
        status_code=303,
        headers={"Cache-Control": "no-store"},
    )


def _invalid() -> RedirectResponse:
    return _redirect("/digest/invalid")


def _secret() -> str:
    secret = settings.token_secret()
    if not secret:
        raise HTTPException(status_code=503, detail="digest_unavailable")
    return secret


@router.get("/status")
async def status() -> JSONResponse:
    _require_enabled()
    # Do not show the form until the two server-side pieces are present. The
    # owner sets both secrets before flipping DIGEST_ENABLED.
    if not settings.token_secret() or not settings.resend_api_key():
        raise HTTPException(status_code=503, detail="digest_not_configured")
    return JSONResponse(
        {"enabled": True}, headers={"Cache-Control": "no-store"}
    )


@router.post("/subscribe", status_code=202)
async def subscribe(request: Request) -> JSONResponse:
    _require_enabled()
    raw = await request.body()
    if len(raw) > MAX_BODY:
        raise HTTPException(status_code=413, detail="Payload too large")
    if not _origin_ok(request):
        raise HTTPException(status_code=403, detail="Forbidden")
    try:
        payload = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=422, detail="Invalid JSON") from exc
    if not isinstance(payload, dict):
        raise HTTPException(status_code=422, detail="Invalid subscription")

    email = normalise_email(payload.get("email"))
    if email is None:
        raise HTTPException(status_code=422, detail="invalid_email")
    if payload.get("consent") is not True:
        raise HTTPException(status_code=422, detail="consent_required")
    # Honeypot: answer exactly like a real request and do nothing.
    if str(payload.get("website") or "").strip():
        return _accepted()

    now_ms = int(time.time() * 1000)
    store: DigestStore = get_store()
    if not store.subscribe_limit.take(_net_key(request), 1, now_ms / 1000):
        raise HTTPException(status_code=429, detail="rate_limited")

    subscriber, should_send = await run_in_threadpool(
        store.prepare_subscription, email, now_ms
    )
    if should_send:
        try:
            token = sign_token(
                _secret(),
                "confirm",
                int(subscriber["id"]),
                str(subscriber["token_nonce"]),
                now=now_ms // 1000,
            )
            confirm_url = (
                f"{settings.base_url()}/api/digest/confirm"
                f"?t={quote(token, safe='')}"
            )
            rendered = render_confirmation(
                confirm_url, base_url=settings.base_url()
            )
            mail = Mail(
                to=email,
                subject=rendered.subject,
                html=rendered.html,
                text=rendered.text,
                from_address=settings.from_address(),
                reply_to=settings.reply_to(),
            )
            await run_in_threadpool(get_mailer().send, mail)
        except TokenError:
            logger.error("digest confirmation not sent: token secret is missing")
        except Exception as exc:  # noqa: BLE001 - the public answer must not change
            logger.warning(
                "digest confirmation failed masked=%s error=%s",
                mask_email(email),
                type(exc).__name__,
            )

    logger.info(
        "digest subscribe masked=%s status=%s",
        mask_email(email),
        subscriber["status"],
    )
    return _accepted()


@router.get("/confirm")
async def confirm(request: Request, t: str | None = None) -> RedirectResponse:
    _require_enabled()
    del request
    if not t:
        return _invalid()
    secret = _secret()
    try:
        payload = verify_token(secret, t, "confirm")
    except TokenError:
        return _invalid()
    store: DigestStore = get_store()
    ok = await run_in_threadpool(
        store.confirm, int(payload["s"]), str(payload["n"])
    )
    return _redirect("/digest/confirmed" if ok else "/digest/invalid")


@router.get("/unsubscribe")
async def unsubscribe_page(
    request: Request, t: str | None = None
) -> RedirectResponse:
    _require_enabled()
    del request
    if not t:
        return _invalid()
    secret = _secret()
    try:
        payload = verify_token(secret, t, "unsub")
    except TokenError:
        return _invalid()
    store: DigestStore = get_store()
    row = await run_in_threadpool(store.get_by_id, int(payload["s"]))
    if row is None or str(row["token_nonce"]) != str(payload["n"]):
        return _invalid()
    return _redirect(f"/digest/unsubscribe?t={quote(t, safe='')}")


@router.post("/unsubscribe")
async def unsubscribe(request: Request, t: str | None = None) -> JSONResponse:
    _require_enabled()
    del request
    if not t:
        raise HTTPException(status_code=400, detail="invalid_token")
    secret = _secret()
    try:
        payload = verify_token(secret, t, "unsub")
    except TokenError as exc:
        raise HTTPException(status_code=400, detail="invalid_token") from exc
    store: DigestStore = get_store()
    ok = await run_in_threadpool(
        store.unsubscribe, int(payload["s"]), str(payload["n"])
    )
    if not ok:
        raise HTTPException(status_code=400, detail="invalid_token")
    logger.info("digest unsubscribe subscriber=%s", payload["s"])
    return JSONResponse(
        {"status": "unsubscribed"}, headers={"Cache-Control": "no-store"}
    )
