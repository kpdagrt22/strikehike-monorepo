"""Normalisation helpers: text, slugs, dates, times and IANA zones."""

from __future__ import annotations

import re
import unicodedata
from datetime import date, time
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

_SLUG_RE = re.compile(r"[^a-z0-9]+")
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_TIME_RE = re.compile(r"^\d{2}:\d{2}(?::\d{2})?$")


def normalize_text(value: object, *, collapse_whitespace: bool = True) -> str:
    """NFC-normalise and trim text; optionally collapse runs of whitespace.

    Collapsing whitespace keeps hashes stable across sources that wrap the same
    sentence differently, while preserving the words themselves.
    """

    text = unicodedata.normalize("NFC", str(value or "")).strip()
    if collapse_whitespace:
        text = " ".join(text.split())
    return text


def slugify(value: str, *, max_length: int = 80) -> str:
    """ASCII slug used in deterministic event ids.

    Accented Latin text is transliterated; scripts without an ASCII form fall
    back to a short hash so two different names cannot collapse to "event".
    """

    normalized = unicodedata.normalize("NFKD", value)
    ascii_text = normalized.encode("ascii", "ignore").decode("ascii").lower()
    slug = _SLUG_RE.sub("-", ascii_text).strip("-")
    if not slug:
        stripped = unicodedata.normalize("NFC", value).strip()
        if not any(character.isalnum() for character in stripped):
            return "event"
        import hashlib

        slug = "event-" + hashlib.sha256(value.encode("utf-8")).hexdigest()[:8]
    return slug[:max_length].strip("-") or "event"


def parse_date(value: object) -> date:
    text = normalize_text(value)
    if not _DATE_RE.match(text):
        raise ValueError(f"date must be YYYY-MM-DD, got {text!r}")
    return date.fromisoformat(text)


def parse_time(value: object) -> time:
    text = normalize_text(value)
    if not _TIME_RE.match(text):
        raise ValueError(f"time must be HH:MM or HH:MM:SS, got {text!r}")
    return time.fromisoformat(text)


def validate_timezone(value: str | None) -> str | None:
    """Return the zone name if it is a valid IANA zone, else raise."""

    if value is None:
        return None
    text = normalize_text(value)
    if not text:
        return None
    try:
        ZoneInfo(text)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise ValueError(f"unknown IANA timezone: {text!r}") from exc
    return text


def is_https_url(value: str | None) -> bool:
    """Require an absolute https URL with a host; http and relative links fail."""

    from urllib.parse import urlparse

    if not value:
        return False
    parsed = urlparse(value)
    return parsed.scheme == "https" and bool(parsed.netloc)


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def as_float(value: Any) -> float:
    return float(value)
