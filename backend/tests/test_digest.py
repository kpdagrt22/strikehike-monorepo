from __future__ import annotations

import json
import logging
import re
import time

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from astro_finance.digest import router as router_module
from astro_finance.digest import settings
from astro_finance.digest.content import RoundupNotFound, fetch_roundup
from astro_finance.digest.mailer import (
    Mail,
    ResendAuthError,
    ResendError,
    ResendMailer,
)
from astro_finance.digest.render import render_roundup
from astro_finance.digest.router import router
from astro_finance.digest.send import SendError, send_week
from astro_finance.digest.store import DigestStore
from astro_finance.digest.tokens import TokenError, sign_token, verify_token

SECRET = "test-secret"
BASE = "https://strikehike.com"
LEDGER_ENTRY = {
    "seq": 1,
    "week": "2026-W46",
    "hash": "a" * 64,
}

ROUNDUP = {
    "week": "2026-W46",
    "start": "2026-11-09",
    "end": "2026-11-15",
    "generated_at": "2026-11-11T09:28:18.978Z",
    "approved": True,
    "regime": {
        "as_of": "2026-10-27",
        "score": 15.76,
        "label": "Steady",
        "previous_score": 16.53,
        "change": -0.8,
    },
    "lines": {"regime": "Core Index +15.8 (Steady), -0.8 from last week."},
}


class FakeMailer:
    def __init__(self) -> None:
        self.sent: list[Mail] = []

    def send(self, mail: Mail) -> str:
        self.sent.append(mail)
        return f"provider-{len(self.sent)}"


def add_active(store: DigestStore, email: str) -> dict:
    subscriber, _ = store.prepare_subscription(email, now_ms=1)
    assert store.confirm(subscriber["id"], subscriber["token_nonce"], now_ms=2)
    row = store.get_by_email(email)
    assert row is not None
    return row


def token_from(text: str, purpose: str = "confirm") -> str:
    pattern = rf"https://strikehike\.com/api/digest/{purpose}\?t=([^\s]+)"
    match = re.search(pattern, text)
    assert match, text
    return match.group(1)


def unsubscribe_token(row: dict) -> str:
    return sign_token(SECRET, "unsub", int(row["id"]), str(row["token_nonce"]))


@pytest.fixture
def digest(tmp_path, monkeypatch):
    store = DigestStore(tmp_path / "digest.sqlite")
    mailer = FakeMailer()
    monkeypatch.setenv("DIGEST_ENABLED", "1")
    monkeypatch.setenv("DIGEST_TOKEN_SECRET", SECRET)
    monkeypatch.setenv("RESEND_API_KEY", "test-key")
    monkeypatch.setenv("DIGEST_BASE_URL", BASE)
    monkeypatch.setenv("DIGEST_FROM", "StrikeHike <digest@strikehike.com>")
    monkeypatch.setenv("DIGEST_POSTAL_ADDRESS", "1 Test Street, Test City")
    monkeypatch.setattr(router_module, "get_store", lambda: store)
    monkeypatch.setattr(router_module, "get_mailer", lambda: mailer)
    app = FastAPI()
    app.include_router(router, prefix="/api")
    client = TestClient(app, follow_redirects=False)
    yield client, store, mailer
    store.close()


def subscribe(client: TestClient, email: str, *, net: str = "test-net", **extra):
    body = {"email": email, "consent": True, "website": ""}
    body.update(extra)
    return client.post(
        "/api/digest/subscribe",
        json=body,
        headers={"Origin": BASE, "X-SH-Net": net},
    )


def test_token_valid_expired_tampered_and_purpose_bound():
    now = int(time.time())
    token = sign_token(SECRET, "confirm", 7, "nonce", now=now, expires_at=now + 60)
    payload = verify_token(SECRET, token, "confirm", now=now + 1)
    assert payload["s"] == 7 and payload["n"] == "nonce"

    expired = sign_token(SECRET, "confirm", 7, "nonce", now=now, expires_at=now - 1)
    with pytest.raises(TokenError):
        verify_token(SECRET, expired, "confirm", now=now)

    tampered = token[:-1] + ("A" if token[-1] != "A" else "B")
    with pytest.raises(TokenError):
        verify_token(SECRET, tampered, "confirm", now=now)
    with pytest.raises(TokenError):
        verify_token(SECRET, token + "é", "confirm", now=now)

    with pytest.raises(TokenError):
        verify_token(SECRET, token, "unsub", now=now)

    old_unsub = sign_token(SECRET, "unsub", 7, "nonce", now=now - 10_000_000)
    assert verify_token(SECRET, old_unsub, "unsub", now=now)["s"] == 7


def test_subscribe_confirm_unsubscribe_and_resubscribe(digest):
    client, store, mailer = digest
    first = subscribe(client, "Kate@Example.com ")
    assert first.status_code == 202
    assert first.json() == {"status": "check_inbox"}
    row = store.get_by_email("kate@example.com")
    assert row is not None and row["status"] == "pending"
    assert len(mailer.sent) == 1

    confirm_token = token_from(mailer.sent[0].text)
    page = client.get(f"/api/digest/confirm?t={confirm_token}")
    assert page.status_code == 303
    assert "/digest/confirm?t=" in page.headers["location"]
    row = store.get_by_email("kate@example.com")
    assert row["status"] == "pending" and row["confirmed_at"] is None

    confirmed = client.post(f"/api/digest/confirm?t={confirm_token}")
    assert confirmed.status_code == 303
    assert confirmed.headers["location"].endswith("/digest/confirmed")
    row = store.get_by_email("kate@example.com")
    assert row["status"] == "active" and row["confirmed_at"] is not None

    unsub = unsubscribe_token(row)
    page = client.get(f"/api/digest/unsubscribe?t={unsub}")
    assert page.status_code == 303
    assert "/digest/unsubscribe?t=" in page.headers["location"]

    posted = client.post(f"/api/digest/unsubscribe?t={unsub}")
    assert posted.status_code == 200
    assert posted.json() == {"status": "unsubscribed"}
    row = store.get_by_email("kate@example.com")
    assert row["status"] == "unsubscribed" and row["unsubscribed_at"] is not None
    old_nonce = row["token_nonce"]

    again = subscribe(client, "kate@example.com")
    assert again.status_code == 202
    assert len(mailer.sent) == 2
    row = store.get_by_email("kate@example.com")
    assert row["status"] == "pending"
    assert row["token_nonce"] != old_nonce

    new_token = token_from(mailer.sent[1].text)
    assert new_token != confirm_token
    assert client.get(f"/api/digest/confirm?t={new_token}").status_code == 303
    assert store.get_by_email("kate@example.com")["status"] == "pending"
    assert client.post(f"/api/digest/confirm?t={new_token}").status_code == 303
    assert store.get_by_email("kate@example.com")["status"] == "active"


def test_subscribe_answer_is_identical_for_every_status(digest):
    client, store, mailer = digest
    assert subscribe(client, "same@example.com").json() == {"status": "check_inbox"}
    pending = subscribe(client, "same@example.com")
    assert pending.status_code == 202 and pending.json() == {"status": "check_inbox"}
    assert len(mailer.sent) == 1  # pending resend is throttled for ten minutes

    row = store.get_by_email("same@example.com")
    assert client.post(
        f"/api/digest/confirm?t={token_from(mailer.sent[0].text)}"
    ).status_code == 303
    active = subscribe(client, "same@example.com")
    assert active.status_code == 202 and active.json() == {"status": "check_inbox"}
    assert len(mailer.sent) == 1

    unsub = unsubscribe_token(store.get_by_email("same@example.com"))
    assert client.post(f"/api/digest/unsubscribe?t={unsub}").status_code == 200
    after = subscribe(client, "same@example.com")
    assert after.status_code == 202 and after.json() == {"status": "check_inbox"}
    assert len(mailer.sent) == 2
    assert store.get_by_email("same@example.com")["status"] == "pending"


def test_honeypot_invalid_email_and_missing_consent(digest):
    client, store, mailer = digest
    assert subscribe(client, "bot@example.com", website="spam").status_code == 202
    assert store.get_by_email("bot@example.com") is None
    assert mailer.sent == []

    assert subscribe(client, "not-an-email").status_code == 422
    assert subscribe(client, "no-consent@example.com", consent=False).status_code == 422


def test_rate_limit_per_network(digest):
    client, _, _ = digest
    for index in range(5):
        assert subscribe(client, f"rate{index}@example.com", net="rate-net").status_code == 202
    assert subscribe(client, "rate5@example.com", net="rate-net").status_code == 429
    assert subscribe(client, "other@example.com", net="other-net").status_code == 202


def test_status_is_available_when_enabled(digest):
    client, _, _ = digest
    response = client.get("/api/digest/status")
    assert response.status_code == 200
    assert response.json() == {"enabled": True}


def test_real_send_requires_a_postal_address(digest, monkeypatch):
    _, store, _ = digest
    add_active(store, "one@example.com")
    monkeypatch.delenv("DIGEST_POSTAL_ADDRESS")
    with pytest.raises(SendError) as exc:
        send_week(
            "2026-W46",
            dry_run=False,
            store=store,
            mailer=FakeMailer(),
            fetch=lambda week: ROUNDUP,
        ledger=LEDGER_ENTRY,
        )
    assert "DIGEST_POSTAL_ADDRESS" in str(exc.value)


def test_off_switch_returns_404(digest, monkeypatch):
    client, _, _ = digest
    monkeypatch.setenv("DIGEST_ENABLED", "0")
    assert client.get("/api/digest/status").status_code == 404
    assert subscribe(client, "off@example.com").status_code == 404
    assert client.get("/api/digest/confirm?t=anything").status_code == 404
    assert client.post("/api/digest/confirm?t=anything").status_code == 404
    assert client.post("/api/digest/unsubscribe?t=anything").status_code == 404


def test_logs_never_contain_the_full_address(digest, caplog):
    client, _, _ = digest
    caplog.set_level(logging.INFO, logger="astro_finance.digest")
    assert subscribe(client, "kate@example.com").status_code == 202
    assert "kate@example.com" not in caplog.text
    assert "k***@e***.com" in caplog.text


def test_dry_run_writes_one_sample_and_sends_nothing(tmp_path, digest):
    _, store, _ = digest
    add_active(store, "one@example.com")
    add_active(store, "two@example.com")
    calls: list[str] = []

    def fetch(week: str) -> dict:
        calls.append(week)
        return ROUNDUP

    mailer = FakeMailer()
    result = send_week(
        "2026-W46",
        dry_run=True,
        store=store,
        mailer=mailer,
        fetch=fetch,
        ledger=LEDGER_ENTRY,
        sample_dir=tmp_path / "samples",
    )
    assert result.recipients == 2
    assert result.eligible == 2
    assert result.stuck == 0
    assert result.sent == 0
    assert result.sample_email == "o***@e***.com"
    assert mailer.sent == []
    assert calls == ["2026-W46"]
    assert (tmp_path / "samples" / "digest-2026-W46.html").exists()
    assert (tmp_path / "samples" / "digest-2026-W46.txt").exists()
    assert store.send_counts("2026-W46") == {}


def test_send_is_idempotent_and_uses_unsubscribe_headers(digest):
    _, store, _ = digest
    add_active(store, "one@example.com")
    add_active(store, "two@example.com")
    mailer = FakeMailer()

    first = send_week(
        "2026-W46",
        dry_run=False,
        store=store,
        mailer=mailer,
        fetch=lambda week: ROUNDUP,
        ledger=LEDGER_ENTRY,
        now_ms=100,
    )
    assert first.sent == 2
    assert len(mailer.sent) == 2
    assert store.send_counts("2026-W46") == {"sent": 2}
    expected_keys = {
        f"digest-2026-W46-{subscriber['id']}"
        for subscriber in store.active_subscribers()
    }
    assert {mail.idempotency_key for mail in mailer.sent} == expected_keys
    for mail in mailer.sent:
        assert mail.headers["List-Unsubscribe"].startswith("<https://strikehike.com/api/digest/unsubscribe?t=")
        assert mail.headers["List-Unsubscribe-Post"] == "List-Unsubscribe=One-Click"
        assert "You're getting this because you subscribed on strikehike.com." in mail.text
        assert "Unsubscribe:" in mail.text
        assert "not investment advice and not a forecast" in mail.text

    second = send_week(
        "2026-W46",
        dry_run=False,
        store=store,
        mailer=mailer,
        fetch=lambda week: ROUNDUP,
        ledger=LEDGER_ENTRY,
        now_ms=200,
    )
    assert second.sent == 0
    assert second.already_sent == 2
    assert second.stuck == 0
    assert len(mailer.sent) == 2


def test_resend_mock_transport_retries_and_stops_on_auth():
    requests: list[httpx.Request] = []
    sleeps: list[float] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json={"id": "provider-1"})

    mailer = ResendMailer(
        "test-key",
        "StrikeHike <digest@strikehike.com>",
        transport=httpx.MockTransport(handler),
        sleep=sleeps.append,
    )
    mail = Mail(
        to="one@example.com",
        subject="Subject",
        html="<p>Hi</p>",
        text="Hi",
        headers={
            "List-Unsubscribe": "<https://strikehike.com/api/digest/unsubscribe?t=x>",
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
        idempotency_key="digest-2026-W46-7",
    )
    assert mailer.send(mail) == "provider-1"
    assert len(requests) == 1
    body = json.loads(requests[0].content)
    assert body["from"] == "StrikeHike <digest@strikehike.com>"
    assert body["headers"]["List-Unsubscribe-Post"] == "List-Unsubscribe=One-Click"
    assert requests[0].headers["authorization"] == "Bearer test-key"
    assert requests[0].headers["idempotency-key"] == "digest-2026-W46-7"

    calls = {"n": 0}

    def retry_handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if calls["n"] == 1:
            return httpx.Response(429)
        return httpx.Response(200, json={"id": "provider-2"})

    retrying = ResendMailer(
        "test-key",
        "StrikeHike <digest@strikehike.com>",
        transport=httpx.MockTransport(retry_handler),
        sleep=sleeps.append,
    )
    assert retrying.send(mail) == "provider-2"
    assert calls["n"] == 2
    assert sleeps == [1.0]

    def auth_handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401)

    auth = ResendMailer(
        "test-key",
        "StrikeHike <digest@strikehike.com>",
        transport=httpx.MockTransport(auth_handler),
        sleep=sleeps.append,
    )
    with pytest.raises(ResendAuthError):
        auth.send(mail)

    def failing_handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500)

    failing = ResendMailer(
        "test-key",
        "StrikeHike <digest@strikehike.com>",
        transport=httpx.MockTransport(failing_handler),
        sleep=sleeps.append,
        backoff_seconds=0,
    )
    with pytest.raises(ResendError):
        failing.send(mail)


def test_resend_payload_carries_reply_to_only_when_set():
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json={"id": "provider-reply"})

    mailer = ResendMailer(
        "test-key",
        "StrikeHike <digest@strikehike.com>",
        transport=httpx.MockTransport(handler),
        sleep=lambda _: None,
    )
    base = {
        "to": "one@example.com",
        "subject": "Subject",
        "html": "<p>Hi</p>",
        "text": "Hi",
    }
    mailer.send(Mail(**base, reply_to="kp@example.com"))
    mailer.send(Mail(**base))
    first = json.loads(requests[0].content)
    second = json.loads(requests[1].content)
    assert first["reply_to"] == "kp@example.com"
    assert "reply_to" not in second


def test_resend_transport_errors_retry_with_backoff_then_succeed():
    calls = {"n": 0}
    sleeps: list[float] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if calls["n"] < 3:
            raise httpx.ConnectTimeout("timeout")
        return httpx.Response(200, json={"id": "provider-3"})

    mailer = ResendMailer(
        "test-key",
        "StrikeHike <digest@strikehike.com>",
        transport=httpx.MockTransport(handler),
        sleep=sleeps.append,
    )
    mail = Mail(
        to="one@example.com",
        subject="Subject",
        html="<p>Hi</p>",
        text="Hi",
        idempotency_key="digest-2026-W46-7",
    )
    assert mailer.send(mail) == "provider-3"
    assert calls["n"] == 3
    assert sleeps == [1.0, 2.0]


def test_failed_send_is_retried_once_and_then_skipped(digest):
    _, store, _ = digest
    subscriber = add_active(store, "one@example.com")

    class FailingMailer(FakeMailer):
        def send(self, mail: Mail) -> str:
            self.sent.append(mail)
            raise RuntimeError("provider unavailable")

    failing = FailingMailer()
    first = send_week(
        "2026-W46",
        dry_run=False,
        store=store,
        mailer=failing,
        fetch=lambda week: ROUNDUP,
        ledger=LEDGER_ENTRY,
    )
    assert first.failed == 1
    assert store.send_counts("2026-W46") == {"failed": 1}

    retry = FakeMailer()
    second = send_week(
        "2026-W46",
        dry_run=False,
        store=store,
        mailer=retry,
        fetch=lambda week: ROUNDUP,
        ledger=LEDGER_ENTRY,
    )
    assert second.sent == 1
    assert second.already_sent == 0
    assert retry.sent[0].idempotency_key == f"digest-2026-W46-{subscriber['id']}"
    assert store.send_counts("2026-W46") == {"sent": 1}

    third = send_week(
        "2026-W46",
        dry_run=False,
        store=store,
        mailer=retry,
        fetch=lambda week: ROUNDUP,
        ledger=LEDGER_ENTRY,
    )
    assert third.sent == 0
    assert third.already_sent == 1
    assert len(retry.sent) == 1


def test_sending_row_is_stuck_and_not_retried(digest):
    _, store, _ = digest
    subscriber = add_active(store, "one@example.com")
    assert store.reserve_send(subscriber["id"], "2026-W46", 10) is True

    mailer = FakeMailer()
    result = send_week(
        "2026-W46",
        dry_run=False,
        store=store,
        mailer=mailer,
        fetch=lambda week: ROUNDUP,
        ledger=LEDGER_ENTRY,
    )
    assert result.stuck == 1
    assert result.eligible == 0
    assert result.sent == 0
    assert mailer.sent == []
    assert store.send_counts("2026-W46") == {"sending": 1}


def test_content_base_url_prefers_the_internal_origin(monkeypatch):
    monkeypatch.setenv("DIGEST_CONTENT_URL", "http://frontend:3000")
    assert settings.content_base_url() == "http://frontend:3000"


def test_auth_failure_stops_first_run_and_can_be_retried(digest):
    _, store, _ = digest
    add_active(store, "one@example.com")

    class AuthMailer(FakeMailer):
        def send(self, mail: Mail) -> str:
            self.sent.append(mail)
            raise ResendAuthError(401)

    mailer = AuthMailer()
    first = send_week(
        "2026-W46",
        dry_run=False,
        store=store,
        mailer=mailer,
        fetch=lambda week: ROUNDUP,
        ledger=LEDGER_ENTRY,
    )
    assert first.failed == 1
    assert store.send_counts("2026-W46") == {"failed": 1}

    retry = FakeMailer()
    second = send_week(
        "2026-W46",
        dry_run=False,
        store=store,
        mailer=retry,
        fetch=lambda week: ROUNDUP,
        ledger=LEDGER_ENTRY,
    )
    assert second.sent == 1
    assert second.failed == 0
    assert len(retry.sent) == 1
    assert store.send_counts("2026-W46") == {"sent": 1}


def test_roundup_route_only_serves_approved_weeks():
    def handler(request: httpx.Request) -> httpx.Response:
        if "2026-W46" in str(request.url):
            return httpx.Response(200, json=ROUNDUP)
        if "2026-W45" in str(request.url):
            return httpx.Response(200, json={**ROUNDUP, "week": "2026-W45", "approved": False})
        return httpx.Response(404)

    transport = httpx.MockTransport(handler)
    assert fetch_roundup("2026-W46", base_url=BASE, transport=transport)["week"] == "2026-W46"
    with pytest.raises(RoundupNotFound):
        fetch_roundup("2026-W45", base_url=BASE, transport=transport)
    with pytest.raises(RoundupNotFound):
        fetch_roundup("2026-W44", base_url=BASE, transport=transport)


def test_render_has_no_tracking_and_carries_the_footer():
    rendered = render_roundup(
        ROUNDUP,
        unsubscribe_url="https://strikehike.com/api/digest/unsubscribe?t=x",
        postal_address="1 Test Street, Test City",
        base_url=BASE,
        ledger={"seq": 1, "hash": "a" * 64},
    )
    assert "This week: macro + sky" in rendered.html
    assert "Unsubscribe in one click" in rendered.html
    assert "You&#x27;re getting this because you subscribed on strikehike.com." in rendered.html
    assert "You're getting this because you subscribed on strikehike.com." in rendered.text
    assert "not investment advice and not a forecast" in rendered.text
    assert "Ledger #1 · aaaaaaaaaaaa — strikehike.com/ledger" in rendered.text
    assert "Ledger #1 · aaaaaaaaaaaa — strikehike.com/ledger" in rendered.html
    assert "1 Test Street, Test City" in rendered.text
    assert "<img" not in rendered.html.lower()
    assert "https://strikehike.com/this-week/2026-W46" in rendered.text
