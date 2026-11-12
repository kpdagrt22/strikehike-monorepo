"""Resend HTTP sender with bounded retries.

Only ``httpx`` is used, and it is already a backend runtime dependency. Tests
pass an ``httpx.MockTransport`` so no test can reach the network.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Callable

import httpx

RESEND_URL = "https://api.resend.com/emails"
RETRY_STATUSES = frozenset({429, 500, 502, 503, 504})
MAX_ATTEMPTS = 3


@dataclass(frozen=True)
class Mail:
    to: str
    subject: str
    html: str
    text: str
    headers: dict[str, str] = field(default_factory=dict)
    from_address: str = ""
    reply_to: str | None = None


class ResendError(RuntimeError):
    def __init__(self, status: int):
        super().__init__(f"Resend returned HTTP {status}")
        self.status = status


class ResendAuthError(ResendError):
    """401/403: stop the run; retrying cannot help."""


class ResendMailer:
    def __init__(
        self,
        api_key: str,
        from_address: str,
        reply_to: str | None = None,
        *,
        transport: httpx.BaseTransport | None = None,
        sleep: Callable[[float], None] = time.sleep,
        timeout: float = 15.0,
        backoff_seconds: float = 1.0,
    ):
        if not api_key:
            raise ValueError("RESEND_API_KEY is not configured")
        self.api_key = api_key
        self.from_address = from_address
        self.reply_to = reply_to
        self.transport = transport
        self.sleep = sleep
        self.timeout = timeout
        self.backoff_seconds = backoff_seconds

    def send(self, mail: Mail) -> str:
        payload: dict[str, object] = {
            "from": mail.from_address or self.from_address,
            "to": [mail.to],
            "subject": mail.subject,
            "html": mail.html,
            "text": mail.text,
            "headers": mail.headers,
        }
        reply_to = mail.reply_to or self.reply_to
        if reply_to:
            payload["reply_to"] = reply_to

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        with httpx.Client(
            transport=self.transport,
            timeout=self.timeout,
            follow_redirects=False,
        ) as client:
            for attempt in range(1, MAX_ATTEMPTS + 1):
                response = client.post(RESEND_URL, json=payload, headers=headers)
                if 200 <= response.status_code < 300:
                    try:
                        provider_id = response.json().get("id")
                    except ValueError:
                        provider_id = None
                    return str(provider_id or "")
                if response.status_code in {401, 403}:
                    raise ResendAuthError(response.status_code)
                retryable = response.status_code in RETRY_STATUSES or (
                    500 <= response.status_code < 600
                )
                if not retryable or attempt == MAX_ATTEMPTS:
                    raise ResendError(response.status_code)
                self.sleep(self.backoff_seconds * (2 ** (attempt - 1)))
        raise ResendError(0)
