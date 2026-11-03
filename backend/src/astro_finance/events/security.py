"""Secret redaction and detection, shared by logging and the safety gate.

The regular expressions are deliberately conservative.  The 32-character FRED
key pattern uses hex boundaries so it cannot match half of a 64-character
SHA-256 digest, which is how this module's own hashes appear in the bundle.
"""

from __future__ import annotations

import os
import re
from typing import Iterable

REDACTED = "REDACTED"

_SECRET_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"(?i)\b(api[_-]?key)\s*=\s*[^&\s'\"<>)]+"),
    re.compile(r"(?i)\b(token|secret|password|passwd)\s*=\s*[^&\s'\"<>)]+"),
    re.compile(r"(?i)\bBearer\s+[A-Za-z0-9._~+/=-]+"),
    re.compile(
        r"-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----.*?-----END [A-Z0-9 ]*PRIVATE KEY-----",
        re.DOTALL,
    ),
    # A standalone 32-hex value, not a slice of a longer digest.
    re.compile(r"(?<![0-9a-f])[0-9a-f]{32}(?![0-9a-f])"),
)

_TOKEN_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"(?i)\bapi[_-]?key\s*=\s*[^&\s'\"<>)]+"),
    re.compile(r"(?i)\b(token|secret|password|passwd)\s*=\s*[^&\s'\"<>)]+"),
    re.compile(r"(?i)\bBearer\s+[A-Za-z0-9._~+/=-]+"),
    re.compile(r"-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----"),
    re.compile(r"(?<![0-9a-f])[0-9a-f]{32}(?![0-9a-f])"),
)


def _environment_secrets() -> tuple[str, ...]:
    values = []
    for name in ("FRED_API_KEY",):
        value = os.environ.get(name, "").strip()
        if value:
            values.append(value)
    return tuple(values)


def redact_secrets(text: object, extra_secrets: Iterable[str] = ()) -> str:
    """Remove credential values from arbitrary text before logging or writing."""

    redacted = str(text)
    secrets = tuple(s for s in (*_environment_secrets(), *extra_secrets) if s)
    for secret in sorted(secrets, key=len, reverse=True):
        redacted = redacted.replace(secret, REDACTED)
    for pattern in _SECRET_PATTERNS:
        if pattern.groups:
            redacted = pattern.sub(lambda m: f"{m.group(1)}={REDACTED}", redacted)
        else:
            redacted = pattern.sub(REDACTED, redacted)
    return redacted


def find_secret_patterns(text: str, extra_secrets: Iterable[str] = ()) -> list[str]:
    """Return human-readable findings for the safety gate; empty means clean."""

    findings: list[str] = []
    for secret in (*_environment_secrets(), *extra_secrets):
        if secret and secret in text:
            findings.append("a known credential value is present")
            break
    for pattern in _TOKEN_PATTERNS:
        match = pattern.search(text)
        if match:
            findings.append(f"matched {match.group(0)[:24]!r}")
    return findings


def redact_url(url: str) -> str:
    """Redact query credentials while keeping the URL useful in a log line."""

    return redact_secrets(url)
