"""Environment settings for the digest.

Every value is read at call time so tests and the CLI can change the
environment without reloading the module. No setting is ever logged.
"""

from __future__ import annotations

import os

DEFAULT_DB = "/app/data/runtime/analytics/digest.sqlite"
DEFAULT_FROM = "StrikeHike <digest@strikehike.com>"
DEFAULT_BASE_URL = "https://strikehike.com"


def enabled() -> bool:
    return os.environ.get("DIGEST_ENABLED", "").strip() == "1"


def token_secret() -> str:
    return os.environ.get("DIGEST_TOKEN_SECRET", "").strip()


def resend_api_key() -> str:
    return os.environ.get("RESEND_API_KEY", "").strip()


def from_address() -> str:
    return os.environ.get("DIGEST_FROM", DEFAULT_FROM).strip() or DEFAULT_FROM


def reply_to() -> str | None:
    value = os.environ.get("DIGEST_REPLY_TO", "").strip()
    return value or None


def postal_address() -> str:
    return os.environ.get("DIGEST_POSTAL_ADDRESS", "").strip()


def base_url() -> str:
    return (os.environ.get("DIGEST_BASE_URL", DEFAULT_BASE_URL).strip() or DEFAULT_BASE_URL).rstrip("/")


def content_base_url() -> str:
    """Where the approved-roundup JSON route is read from.

    Compose sets this to the internal frontend origin (``http://frontend:3000``)
    so the sender never has to leave the compose network. A local CLI without
    that variable falls back to the public site; links inside the email still
    always use ``DIGEST_BASE_URL``.
    """

    return (
        os.environ.get("DIGEST_CONTENT_URL", "").strip() or base_url()
    ).rstrip("/")


def db_path() -> str:
    return os.environ.get("DIGEST_DB", "").strip() or DEFAULT_DB
