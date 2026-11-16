from __future__ import annotations

import hashlib
import json
import logging
import re
import time
from pathlib import Path

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

ROUNDUP_V2 = {
    **ROUNDUP,
    "schema": 2,
    "week": "2026-W47",
    "start": "2026-11-16",
    "end": "2026-11-22",
    "regime": {
        "as_of": "2026-11-08",
        "score": 13.2,
        "label": "Steady",
        "previous_score": 14.9,
        "change": -1.7,
        "weekly": [
            {"date": "2026-10-16", "score": 16.53},
            {"date": "2026-10-23", "score": 15.76},
            {"date": "2026-10-30", "score": 14.9},
            {"date": "2026-11-08", "score": 13.18},
        ],
    },
    "themes": [
        {
            "id": "finance",
            "name": "Finance",
            "events": [
                {
                    "id": "finance:test:cpi",
                    "name": "CPI release",
                    "start_date": "2026-11-18",
                    "start_time": "13:30:00",
                    "timezone": "America/New_York",
                    "start_utc": "2026-11-18T13:30:00Z",
                    "path": "/events/finance~test~cpi",
                }
            ],
        }
    ],
    "sky_week_items": [
        {
            "kind": "new_moon",
            "body": "Moon",
            "at": "2026-11-17T11:47:47Z",
            "path": "/upcoming/science",
            "label": "New moon",
        }
    ],
    "activity": {
        "daily": [{"date": "2026-11-16", "score": 40}],
        "min": 40,
        "max": 70,
        "peak_date": "2026-11-20",
        "closest_past": {
            "date": "1990-04-24",
            "name": "Hubble Space Telescope launched",
            "category": "Science",
            "for_date": "2026-11-20",
            "similarity_percent": 83.8,
        },
        "note": "Geometry match compares planet positions only; it predicts nothing.",
    },
    "next_two_weeks": [
        {
            "id": "finance:fred_release_dates:53-2026-11",
            "name": "Gross Domestic Product (November 2026)",
            "start_date": "2026-11-25",
            "start_time": "08:30:00",
            "timezone": "America/New_York",
            "start_utc": "2026-11-25T13:30:00Z",
            "path": "/events/finance~fred_release_dates~53-2026-11",
        }
    ],
    "from_record": {
        "claim_id": "new-moon",
        "title": "The new moon and the market",
        "result": "No meaningful difference in this record.",
        "result_code": "no_meaningful_difference",
        "path": "/tested/new-moon",
    },
    "lines": {
        "regime": "Core Index +13.2 (Steady), −1.7 from the week before.",
        "dates": "1 date in 1 theme.",
        "sky": "1 sky event this week.",
        "activity": "Sky activity ran 40–70, highest on Fri 20 Nov.",
        "next": "1 date in the next two weeks.",
        "record": "From the record: The new moon and the market — No meaningful difference in this record.",
    },
}


ROUNDUP_CROSS_DATE = {
    **ROUNDUP_V2,
    "week": "2026-W48",
    "start": "2026-11-23",
    "end": "2026-11-29",
    "sky_week_items": [
        {
            "kind": "season",
            "body": "Sun",
            "at": "2026-12-21T20:50:15Z",
            "path": "/upcoming/science",
            "label": "December solstice",
        }
    ],
    "next_two_weeks": [
        {
            "id": "finance:fomc:2026-12",
            "name": "FOMC meeting",
            "start_date": "2026-12-09",
            "start_time": "14:00:00",
            "timezone": "America/New_York",
            "start_utc": "2026-12-09T19:00:00Z",
            "path": "/events/finance~fomc~2026-12",
        }
    ],
    "lines": {
        **ROUNDUP_V2["lines"],
        "sky": "1 sky event this week.",
        "next": "1 date in the next two weeks.",
    },
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


def assert_image_tags(html: str) -> None:
    tags = re.findall(r"<img\b[^>]*>", html, flags=re.I)
    assert tags, "the email should carry its hosted images"
    for tag in tags:
        assert "alt=" in tag, tag
        assert "width=" in tag, tag
        assert "height=" in tag, tag
        assert 'width="1"' not in tag, tag
        assert 'height="1"' not in tag, tag


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


def test_preview_send_goes_to_one_address_and_is_not_recorded(digest):
    _, store, _ = digest
    mailer = FakeMailer()
    result = send_week(
        "2026-W46",
        dry_run=False,
        store=store,
        mailer=mailer,
        fetch=lambda week: ROUNDUP,
        ledger=LEDGER_ENTRY,
        preview_to="owner@example.com",
    )
    assert result.preview is True
    assert result.sent == 1
    assert result.recipients == 1
    assert len(mailer.sent) == 1
    mail = mailer.sent[0]
    assert mail.to == "owner@example.com"
    assert mail.subject.startswith("[Preview] ")
    assert mail.headers["List-Unsubscribe"].startswith(
        "<https://strikehike.com/api/digest/unsubscribe?t="
    )
    assert mail.headers["List-Unsubscribe-Post"] == "List-Unsubscribe=One-Click"
    assert "Unsubscribe in one click" in mail.html
    assert "1 Test Street, Test City" in mail.html
    assert store.send_counts("2026-W46") == {}


def test_preview_nonce_changes_only_the_preview_key(digest):
    _, store, _ = digest
    mailer = FakeMailer()

    def preview(nonce):
        send_week(
            "2026-W46",
            dry_run=False,
            store=store,
            mailer=mailer,
            fetch=lambda week: ROUNDUP,
            ledger=LEDGER_ENTRY,
            preview_to="owner@example.com",
            preview_nonce=nonce,
        )
        return mailer.sent[-1].idempotency_key

    first = preview("run-1")
    second = preview("run-2")
    assert first != second
    assert first.startswith("preview-2026-W46-")
    assert first.endswith("-run-1")
    assert second.endswith("-run-2")
    # No nonce: the old key shape, so an existing preview stays idempotent.
    plain = preview(None)
    assert plain == f"preview-2026-W46-{hashlib.sha1(b'owner@example.com').hexdigest()[:12]}"
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
    assert "Ledger #1" in rendered.html
    assert "aaaaaaaaaaaa" in rendered.html
    assert "strikehike.com/ledger" in rendered.html
    assert "1 Test Street, Test City" in rendered.text
    assert_image_tags(rendered.html)
    assert "https://strikehike.com/this-week/2026-W46" in rendered.text
    assert rendered.subject == "StrikeHike weekly · 9–15 Nov 2026"


def test_render_v2_carries_every_section_and_the_new_subject():
    rendered = render_roundup(
        ROUNDUP_V2,
        unsubscribe_url="https://strikehike.com/api/digest/unsubscribe?t=x",
        postal_address="1 Test Street, Test City",
        base_url=BASE,
        ledger={"seq": 1, "hash": "a" * 64},
    )
    assert rendered.subject == "StrikeHike weekly · 16–22 Nov 2026 · Core Index +13.2"
    # v3 merges the week's dates and sky events into one THIS WEEK timeline.
    for heading in ("THIS WEEK", "SKY ACTIVITY", "NEXT TWO WEEKS", "FROM THE RECORD"):
        assert f"\n{heading}\n" in rendered.text
    assert "Core Index +13.2 (Steady), −1.7 from the week before." in rendered.text
    assert "Latest reading: Sun 8 Nov 2026." in rendered.text
    assert "week of 08 Nov" not in rendered.text
    assert "New moon · Tue 17 Nov 2026 · 11:47 UTC · 17:17 IST" in rendered.text
    assert (
        "CPI release · Wed 18 Nov 2026 · 13:30 UTC · 19:00 IST"
        in rendered.text
    )
    assert (
        "Gross Domestic Product (November 2026) · Wed 25 Nov 2026 · "
        "13:30 UTC · 19:00 IST" in rendered.text
    )
    assert (
        "Closest past sky to Fri 20 Nov: Hubble Space Telescope launched, "
        "Tue 24 Apr 1990 (83.8% geometry match)." in rendered.text
    )
    assert rendered.text.count("Closest past sky") == 1
    assert "1990-04-24" not in rendered.text
    assert "Sky activity ran 40–70, highest on Fri 20 Nov." in rendered.text
    assert "2026-11-20" not in rendered.text
    assert "19:00 IST" in rendered.html
    assert "13:30 UTC" in rendered.html
    assert "17:17 IST" in rendered.html
    assert "The new moon and the market" in rendered.text
    assert "No meaningful difference in this record." in rendered.text
    assert "Geometry match compares planet positions only; it predicts nothing." in rendered.text
    assert "Unsubscribe in one click" in rendered.html
    assert "Ledger #1" in rendered.html
    assert "aaaaaaaaaaaa" in rendered.html
    assert "strikehike.com/ledger" in rendered.html
    assert "1 Test Street, Test City" in rendered.html
    assert_image_tags(rendered.html)


def test_render_v2_prints_the_ist_date_when_it_differs():
    rendered = render_roundup(
        ROUNDUP_CROSS_DATE,
        unsubscribe_url="https://strikehike.com/api/digest/unsubscribe?t=x",
        postal_address="1 Test Street, Test City",
        base_url=BASE,
        ledger={"seq": 1, "hash": "a" * 64},
    )
    assert (
        "FOMC meeting · Wed 9 Dec 2026 · 19:00 UTC · 00:30 IST "
        "(Thu 10 Dec)" in rendered.text
    )
    assert (
        "December solstice · Mon 21 Dec 2026 · 20:50 UTC · 02:20 IST "
        "(Tue 22 Dec)" in rendered.text
    )
    assert "00:30 IST" in rendered.html
    assert "Thu 10 Dec" in rendered.html
    assert "02:20 IST" in rendered.html
    assert "Tue 22 Dec" in rendered.html


def test_render_v2_without_closest_past_omits_the_line():
    roundup = json.loads(json.dumps(ROUNDUP_V2))
    roundup["activity"]["closest_past"] = None
    rendered = render_roundup(
        roundup,
        unsubscribe_url="https://strikehike.com/api/digest/unsubscribe?t=x",
        postal_address="1 Test Street, Test City",
        base_url=BASE,
        ledger={"seq": 1, "hash": "a" * 64},
    )
    assert "Closest past sky" not in rendered.text
    assert "Closest past sky" not in rendered.html


def test_render_v2_flat_activity_has_no_peak_day():
    roundup = json.loads(json.dumps(ROUNDUP_V2))
    roundup["activity"]["min"] = 99
    roundup["activity"]["max"] = 99
    roundup["activity"]["peak_date"] = None
    roundup["lines"]["activity"] = "Sky activity stayed at 99 all week."
    rendered = render_roundup(
        roundup,
        unsubscribe_url="https://strikehike.com/api/digest/unsubscribe?t=x",
        postal_address="1 Test Street, Test City",
        base_url=BASE,
        ledger={"seq": 1, "hash": "a" * 64},
    )
    assert "Sky activity stayed at 99 all week." in rendered.text
    assert "peak" not in rendered.text.lower()
    assert "1990-04-24" not in rendered.text
    assert rendered.text.count("Closest past sky") == 1


def test_render_v2_carries_calendar_actions_and_the_week_calendar():
    rendered = render_roundup(
        ROUNDUP_V2,
        unsubscribe_url="https://strikehike.com/api/digest/unsubscribe?t=x",
        postal_address="1 Test Street, Test City",
        base_url=BASE,
        ledger={"seq": 1, "hash": "a" * 64},
    )
    assert "calendar.google.com/calendar/render?action=TEMPLATE" in rendered.html
    assert "outlook.live.com/calendar/0/action/compose" in rendered.html
    assert "/calendar/event/finance~test~cpi.ics" in rendered.html
    assert "/this-week/2026-W47/calendar/new-moon" in rendered.html
    assert "/this-week/2026-W47/calendar.ics" in rendered.html
    assert "webcal://strikehike.com/calendar/all.ics" in rendered.html
    assert (
        "calendar.google.com/calendar/r?cid=webcal://strikehike.com/calendar/all.ics"
        in rendered.html
    )
    assert "Add these dates:" in rendered.text
    assert "Subscribe to every StrikeHike date: webcal://strikehike.com/calendar/all.ics" in rendered.text


def test_render_v2_is_under_the_gmail_limit_and_links_are_absolute():
    rendered = render_roundup(
        ROUNDUP_V2,
        unsubscribe_url="https://strikehike.com/api/digest/unsubscribe?t=x",
        postal_address="1 Test Street, Test City",
        base_url=BASE,
        ledger={"seq": 1, "hash": "a" * 64},
    )
    assert len(rendered.html.encode("utf-8")) <= 80 * 1024
    hrefs = re.findall(r'href="([^"]+)"', rendered.html)
    assert hrefs
    for href in hrefs:
        assert href.startswith("https://") or href.startswith("webcal://"), href


def test_email_static_images_fit_the_budget():
    root = Path(__file__).resolve().parents[2] / "frontend" / "public" / "email"
    total = sum(path.stat().st_size for path in root.rglob("*.png"))
    assert total <= 150 * 1024


def _ratio(foreground: str, background: str) -> float:
    def luminance(value: str) -> float:
        channels = [int(value[index : index + 2], 16) / 255 for index in (1, 3, 5)]
        linear = [
            channel / 12.92
            if channel <= 0.03928
            else ((channel + 0.055) / 1.055) ** 2.4
            for channel in channels
        ]
        return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]

    first, second = luminance(foreground), luminance(background)
    lighter, darker = max(first, second), min(first, second)
    return (lighter + 0.05) / (darker + 0.05)


def _render_v2(roundup: dict | None = None):
    return render_roundup(
        roundup or ROUNDUP_V2,
        unsubscribe_url="https://strikehike.com/api/digest/unsubscribe?t=x",
        postal_address="1 Test Street, Test City",
        base_url=BASE,
        ledger={"seq": 1, "hash": "a" * 64},
    )


def _without_outlook_blocks(html: str) -> str:
    """Drop the <!--[if mso]> blocks: Outlook on Windows has no dark rules."""

    return re.sub(r"<!--\[if mso\]>.*?<!\[endif\]-->", "", html, flags=re.S)


def test_render_v2_palette_contrast():
    """Every text colour keeps 4.5:1 on every plate it can sit on, both modes."""

    from astro_finance.digest import render

    for palette in (render.LIGHT, render.DARK):
        for text in ("text1", "text2", "text3", "accent", "signal"):
            # page: header, hero, glance, ledger, footer; card: every card;
            # soft: the calendar card and the week chip.
            for plate in ("page", "card", "soft"):
                assert _ratio(palette[text], palette[plate]) >= 4.5, (text, plate, palette)
        # The two buttons.
        assert _ratio(palette["won"], palette["wfill"]) >= 4.5
        assert _ratio(palette["ion"], palette["ifill"]) >= 4.5
        # Non-text marks that carry meaning (WCAG 1.4.11): the latest Core
        # Index bar and the busiest-day bar against the card.
        assert _ratio(palette["barstrong"], palette["card"]) >= 3
        assert _ratio(palette["actpeak"], palette["card"]) >= 3
    # Both modes name the same roles.
    assert render.LIGHT.keys() == render.DARK.keys()


def test_render_v3_dark_rules_reach_every_class():
    from astro_finance.digest import render

    html = _render_v2().html
    styles = re.findall(r"<style>(.*?)</style>", html, flags=re.S)
    # Gmail drops a whole block it can't parse, so the phone rules and the
    # dark rules live in separate blocks.
    phone = next(block for block in styles if "max-width:480px" in block)
    dark = next(block for block in styles if "prefers-color-scheme:dark" in block)
    assert phone != dark
    assert "prefers-color-scheme" not in phone
    for role, cls in render.TEXT_CLASSES.items():
        assert f"color:{render.DARK[role]}!important" in dark.split(f".{cls}{{", 1)[1].split("}", 1)[0]
        # Outlook.com recolours with data-ogsc; it gets the same night palette.
        assert f"[data-ogsc] .{cls}{{color:{render.DARK[role]}!important;}}" in dark
    for cls, role in (("sb", "page"), ("sc", "card"), ("sw", "soft"), ("bw", "wfill"), ("bi", "ifill")):
        assert f".{cls}{{background-color:{render.DARK[role]}!important" in dark
        assert f"[data-ogsb] .{cls}{{background-color:{render.DARK[role]}!important" in dark
    assert '<meta name="color-scheme" content="light dark" />' in html
    for cls in ("sb", "sc", "sw", "t1", "t2", "t3", "ta", "ts", "bw", "bi", "bs", "bn", "ba"):
        assert re.search(rf'class="[^"]*\b{cls}\b', html), cls


def test_render_v2_every_dark_text_colour_has_a_light_override():
    """Every inline text colour carries the class the dark rules target.

    An inline colour beats a class on its parent, so an element without its
    own class keeps the light colour in dark mode (this once left three
    footer links at 2.4:1 in light mode, the mirror case).
    """

    from astro_finance.digest import render

    html = _without_outlook_blocks(_render_v2().html)
    by_colour = {render.LIGHT[role].lower(): cls for role, cls in render.TEXT_CLASSES.items()}
    checked = 0
    for tag in re.findall(r"<[a-z][a-z0-9]*\b[^>]*\bstyle=\"[^\"]*\"[^>]*>", html):
        style = re.search(r'style="([^"]*)"', tag).group(1)
        colour = re.search(r"(?:^|;)\s*color:\s*(#[0-9a-fA-F]{6})", style)
        if not colour or colour.group(1).lower() not in by_colour:
            continue
        checked += 1
        classes = (re.search(r'class="([^"]*)"', tag) or [None, ""])[1].split()
        assert by_colour[colour.group(1).lower()] in classes, tag
    assert checked > 60


ALL_SKY_KINDS = [
    {"kind": kind, "body": body, "at": f"2026-11-{17 + index:02d}T10:00:00Z",
     "path": "/upcoming/science", "label": label}
    for index, (kind, body, label) in enumerate(
        [
            ("new_moon", "Moon", "New moon"),
            ("first_quarter", "Moon", "First quarter"),
            ("full_moon", "Moon", "Full moon"),
            ("last_quarter", "Moon", "Last quarter"),
            ("ingress", "Sun", "Sun enters Vrishchika"),
            ("station_retrograde", "Mercury", "Mercury stations retrograde"),
            ("station_direct", "Mercury", "Mercury stations direct"),
            ("solar_eclipse", "Sun", "Solar eclipse"),
            ("lunar_eclipse", "Moon", "Lunar eclipse"),
            ("season", "Sun", "December solstice"),
            ("mars_saturn_conjunction", "Mars", "Mars–Saturn conjunction"),
        ]
    )
]


def test_render_v3_every_hosted_file_exists_in_public():
    """Each image and the web font point at a file the next deploy serves.

    v2 asked for moon-full-moon.png for a full moon, which never existed.
    """

    public = Path(__file__).resolve().parents[2] / "frontend" / "public"
    roundup = {**ROUNDUP_V2, "sky_week_items": ALL_SKY_KINDS}
    html = _render_v2(roundup).html
    urls = re.findall(r'<img src="([^"]+)"', html)
    urls += re.findall(r"src:url\(([^)]+)\)", html)
    assert len(set(urls)) >= 14
    for url in set(urls):
        assert url.startswith(f"{BASE}/email/"), url
        assert (public / url[len(BASE) + 1 :]).is_file(), url
    for name in ("moon-new", "moon-first-quarter", "moon-full", "moon-last-quarter",
                 "ingress", "station", "eclipse", "season", "orbit", "finance"):
        assert f"/email/v3/icons/{name}.png" in html, name


def test_render_v3_is_email_safe_markup():
    html = _render_v2().html
    assert '<html lang="en"' in html
    assert 'role="article"' in html and 'lang="en"' in html
    tables = re.findall(r"<table\b[^>]*>", html)
    assert tables
    for tag in tables:
        assert 'role="presentation"' in tag, tag
    lowered = html.lower()
    for banned in ("<svg", "display:flex", "display:grid", "<script", "position:absolute"):
        assert banned not in lowered, banned
    # The bulletproof buttons: VML for Outlook on Windows, a link elsewhere.
    assert html.count("<v:roundrect") == 2
    # A hidden preheader carries the week's facts.
    assert re.search(r'<div style="display:none;[^"]*">Core Index \+13\.2 Steady', html)


def test_render_v3_text_part_reads_in_order():
    text = _render_v2().text
    order = [
        "STRIKEHIKE WEEKLY ROUNDUP · 2026-W47",
        "AT A GLANCE",
        "REGIME · CORE INDEX",
        "Last 4 weekly readings: +16.5 (16 Oct), +15.8 (23 Oct), +14.9 (30 Oct), +13.2 (8 Nov)",
        "\nTHIS WEEK\n",
        "\nSKY ACTIVITY\n",
        "\nNEXT TWO WEEKS\n",
        "\nSAVE THE DATES\n",
        "\nFROM THE RECORD\n",
        "Read this week's roundup: https://strikehike.com/this-week/2026-W47",
        "Ledger #1 · aaaaaaaaaaaa",
        "Unsubscribe: https://strikehike.com/api/digest/unsubscribe?t=x",
        "Postal address: 1 Test Street, Test City",
    ]
    positions = [text.index(part) for part in order]
    assert positions == sorted(positions)
    assert "<" not in text and "&amp;" not in text


def _busy_week(in_week: int, sky: int, upcoming: int) -> dict:
    base = ROUNDUP_V2["themes"][0]["events"][0]
    nxt = ROUNDUP_V2["next_two_weeks"][0]
    return {
        **ROUNDUP_V2,
        "themes": [
            {
                "id": "finance",
                "name": "Finance",
                "events": [
                    {**base, "id": f"{base['id']}-{i}", "name": f"Release {i}",
                     "path": f"{base['path']}-{i}"}
                    for i in range(in_week)
                ],
            }
        ],
        "sky_week_items": [
            {**ALL_SKY_KINDS[i % len(ALL_SKY_KINDS)]} for i in range(sky)
        ],
        "next_two_weeks": [
            {**nxt, "id": f"{nxt['id']}-{i}", "path": f"{nxt['path']}-{i}"}
            for i in range(upcoming)
        ],
    }


def test_render_v3_busy_weeks_stay_clear_of_the_gmail_clip():
    """Gmail clips at 102 KB and would hide the footer's unsubscribe link."""

    from astro_finance.digest import render

    normal = _render_v2().html
    assert "+ Outlook" in normal and "Add to calendar (.ics)" not in normal
    # A plausible busy week keeps all three calendar actions per date.
    busy = _render_v2(_busy_week(6, 3, 6)).html
    assert len(busy.encode("utf-8")) <= render.HTML_BUDGET
    assert busy.count("+ Outlook") == 15
    # Past the budget, each date falls back to one .ics action; the week file
    # still carries every date, and the footer stays in.
    for shape in ((10, 4, 6), (24, 8, 6)):
        heavy = _render_v2(_busy_week(*shape)).html
        assert len(heavy.encode("utf-8")) < 100 * 1024, shape
        assert "+ Outlook" not in heavy
        assert heavy.count("Add to calendar (.ics)") == sum(shape)
        assert "Unsubscribe in one click" in heavy
        assert "/this-week/2026-W47/calendar.ics" in heavy


BANNED_COPY = (
    # frontend/scripts/check-copy.mjs, plus the email's own no-advice terms.
    "smart money", "accumulation", "contrarian", "expected to", "is likely to",
    "we expect", "next week will", "this week will", "will rise", "will fall",
    "will outperform", "will underperform", "guaranteed", "sure thing",
    "we predict", "predicts the market", "proves that", "accuracy", "accurate",
    "signal", "buy", "sell", "recommend", "should invest", "target price",
)


def test_render_v3_copy_is_descriptive_only():
    from astro_finance.digest import render

    rendered = _render_v2(_busy_week(2, 3, 2))
    visible = re.sub(r"<!--.*?-->", " ", rendered.html, flags=re.S)
    visible = re.sub(r"<style>.*?</style>|<title>.*?</title>", " ", visible, flags=re.S)
    visible = re.sub(r"<[^>]+>", " ", visible)
    allowed = (render.DISCLAIMER, ROUNDUP_V2["activity"]["note"])
    for body in (visible.replace("&#x27;", "'"), rendered.text):
        for sentence in allowed:
            body = body.replace(sentence, " ")
        lowered = body.lower()
        for term in BANNED_COPY:
            assert not re.search(rf"\b{re.escape(term)}", lowered), term
    assert render.DISCLAIMER in rendered.text
