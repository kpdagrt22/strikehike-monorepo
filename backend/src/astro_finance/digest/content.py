"""Read an approved roundup through the frontend's read-only JSON route.

The sender never reads the frontend's content directory directly: the public
route is the single gate that only serves weeks marked ``approved``.
"""

from __future__ import annotations

import re

import httpx

from . import settings

WEEK_RE = re.compile(r"^\d{4}-W\d{2}$")


class RoundupError(RuntimeError):
    pass


class RoundupNotFound(RoundupError):
    pass


class RoundupUnavailable(RoundupError):
    pass


def fetch_roundup(
    week: str,
    *,
    base_url: str | None = None,
    transport: httpx.BaseTransport | None = None,
    timeout: float = 15.0,
) -> dict:
    if not WEEK_RE.match(week or ""):
        raise RoundupError("week must be YYYY-Www")
    root = (base_url or settings.content_base_url()).rstrip("/")
    url = f"{root}/this-week/{week}/data.json"
    try:
        with httpx.Client(
            transport=transport,
            timeout=timeout,
            follow_redirects=True,
        ) as client:
            response = client.get(url)
    except httpx.HTTPError as exc:
        raise RoundupUnavailable("roundup route is unreachable") from exc
    if response.status_code == 404:
        raise RoundupNotFound(f"no approved roundup for {week}")
    if response.status_code != 200:
        raise RoundupUnavailable(
            f"roundup route returned HTTP {response.status_code}"
        )
    try:
        payload = response.json()
    except ValueError as exc:
        raise RoundupUnavailable("roundup route returned invalid JSON") from exc
    if not isinstance(payload, dict):
        raise RoundupUnavailable("roundup route returned no object")
    if payload.get("approved") is not True or payload.get("week") != week:
        raise RoundupNotFound(f"no approved roundup for {week}")
    return payload
