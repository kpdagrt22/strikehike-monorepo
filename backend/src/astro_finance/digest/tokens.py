"""Purpose-bound HMAC tokens for confirmation and unsubscribe links.

Format: base64url(payload) "." base64url(HMAC-SHA256(payload)).
The payload holds the subscriber id and nonce, never the email address, so a
forwarded link does not expose the address. Confirmation tokens expire after
48 hours; unsubscribe tokens do not expire (RFC 8058 requires one-click links
to keep working).
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import json
import time
from typing import Any

CONFIRM_TTL_SECONDS = 48 * 60 * 60
PURPOSES = frozenset({"confirm", "unsub"})


class TokenError(ValueError):
    """The token is malformed, tampered with, expired or for another purpose."""


def _b64encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _b64decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


def _signature(secret: str, encoded: str) -> str:
    digest = hmac.new(
        secret.encode("utf-8"), encoded.encode("ascii"), hashlib.sha256
    ).digest()
    return _b64encode(digest)


def sign_token(
    secret: str,
    purpose: str,
    subscriber_id: int,
    nonce: str,
    *,
    now: int | None = None,
    expires_at: int | None = None,
) -> str:
    if not secret:
        raise TokenError("token secret is not configured")
    if purpose not in PURPOSES:
        raise TokenError("unknown token purpose")
    payload: dict[str, Any] = {
        "v": 1,
        "p": purpose,
        "s": int(subscriber_id),
        "n": str(nonce),
    }
    if purpose == "confirm":
        payload["exp"] = int(
            expires_at
            if expires_at is not None
            else (int(time.time()) if now is None else int(now)) + CONFIRM_TTL_SECONDS
        )
    encoded = _b64encode(
        json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    )
    return f"{encoded}.{_signature(secret, encoded)}"


def verify_token(
    secret: str,
    token: str,
    purpose: str,
    *,
    now: int | None = None,
) -> dict[str, Any]:
    if not secret:
        raise TokenError("token secret is not configured")
    if purpose not in PURPOSES:
        raise TokenError("unknown token purpose")
    if not isinstance(token, str) or token.count(".") != 1:
        raise TokenError("malformed token")
    encoded, supplied = token.split(".", 1)
    if not encoded or not supplied:
        raise TokenError("malformed token")
    try:
        expected = _signature(secret, encoded)
    except (UnicodeEncodeError, ValueError) as exc:
        raise TokenError("malformed token") from exc
    # Constant-time comparison, including different-length inputs. Encode both
    # sides so a non-ASCII query value is rejected rather than raising.
    if not hmac.compare_digest(expected.encode("ascii"), supplied.encode("utf-8")):
        raise TokenError("bad signature")
    try:
        payload = json.loads(_b64decode(encoded).decode("utf-8"))
    except (ValueError, UnicodeDecodeError, binascii.Error) as exc:
        raise TokenError("malformed payload") from exc
    if not isinstance(payload, dict) or payload.get("v") != 1:
        raise TokenError("unsupported token")
    if payload.get("p") != purpose:
        raise TokenError("wrong purpose")
    subscriber_id = payload.get("s")
    nonce = payload.get("n")
    if not isinstance(subscriber_id, int) or subscriber_id < 1:
        raise TokenError("bad subscriber")
    if not isinstance(nonce, str) or not nonce:
        raise TokenError("bad nonce")
    if purpose == "confirm":
        expires = payload.get("exp")
        if not isinstance(expires, int):
            raise TokenError("missing expiry")
        current = int(time.time()) if now is None else int(now)
        if current >= expires:
            raise TokenError("expired token")
    return payload
