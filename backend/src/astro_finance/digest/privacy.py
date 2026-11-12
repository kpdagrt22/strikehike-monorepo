"""Small privacy helpers shared by the digest routes and the sender."""

from __future__ import annotations

import re

_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def normalise_email(value: object) -> str | None:
    """Return a lower-case address, or None when it is not plausible."""

    if not isinstance(value, str):
        return None
    email = value.strip().lower()
    if len(email) > 254 or not _EMAIL.match(email):
        return None
    local, _, domain = email.partition("@")
    if not local or not domain or "." not in domain:
        return None
    return email


def mask_email(value: str) -> str:
    """k***@d***.com: enough to recognise, never enough to reuse."""

    local, _, domain = (value or "").partition("@")
    if not local or not domain:
        return "***"
    domain_name, _, suffix = domain.rpartition(".")
    if not domain_name or not suffix:
        return f"{local[:1]}***@***"
    return f"{local[:1]}***@{domain_name[:1]}***.{suffix}"
