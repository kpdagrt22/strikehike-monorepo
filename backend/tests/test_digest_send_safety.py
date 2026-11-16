"""SEND-safety for the weekly digest, driven through the CLI as the workflow runs it.

Each test calls ``python -m astro_finance.digest send`` through ``main()``.
The database is a temporary SQLite file, reopened for every run as a new
process would. The approved-only content reader and the Resend client are the
real ones, each behind an ``httpx.MockTransport``, so nothing reaches the
network and no email can leave. Addresses are example.com fixtures.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
from html import unescape
from urllib.parse import urlsplit

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from astro_finance.digest import router as router_module
from astro_finance.digest import send as send_module
from astro_finance.digest import store as store_module
from astro_finance.digest.content import fetch_roundup
from astro_finance.digest.mailer import ResendMailer
from astro_finance.digest.router import router
from astro_finance.digest.send import main
from astro_finance.digest.store import DigestStore

BASE = "https://strikehike.com"
CONTENT = "http://frontend.test"
WEEK = "2026-W48"
NEXT_WEEK = "2026-W49"


def roundup(week: str, *, approved: bool = True) -> dict:
    return {
        "week": week,
        "schema": 2,
        "start": "2026-11-23",
        "end": "2026-11-29",
        "approved": approved,
        "regime": {
            "as_of": "2026-11-15",
            "score": 13.18,
            "label": "Steady",
            "previous_score": 14.9,
            "change": -1.7,
        },
        "lines": {"regime": "Core Index +13.2 (Steady), −1.7 from the week before."},
    }


class Harness:
    """Fake site + fake Resend around the real sender."""

    def __init__(self, tmp_path, monkeypatch, capsys, caplog):
        self.db = tmp_path / "digest.sqlite"
        self.samples = tmp_path / "samples"
        self.capsys = capsys
        self.caplog = caplog
        self.published: dict[str, dict] = {}
        self.ledger_weeks: set[str] = set()
        self.resend: list[httpx.Request] = []
        self.content = httpx.MockTransport(self._site)
        resend = httpx.MockTransport(self._resend)

        for name, value in {
            "DIGEST_DB": str(self.db),
            "DIGEST_TOKEN_SECRET": "test-secret",
            "RESEND_API_KEY": "test-key",
            "DIGEST_BASE_URL": BASE,
            "DIGEST_CONTENT_URL": CONTENT,
            "DIGEST_POSTAL_ADDRESS": "1 Test Street, Test City",
            "DIGEST_ENABLED": "1",
        }.items():
            monkeypatch.setenv(name, value)
        monkeypatch.setattr(store_module, "_store", None)
        monkeypatch.setattr(
            send_module,
            "fetch_roundup",
            lambda week: fetch_roundup(week, transport=self.content),
        )
        monkeypatch.setattr(
            send_module,
            "fetch_ledger_entry",
            lambda week: (
                {"seq": 3, "week": week, "hash": "b" * 64}
                if week in self.ledger_weeks
                else None
            ),
        )
        monkeypatch.setattr(
            send_module,
            "ResendMailer",
            lambda key, sender, reply_to: ResendMailer(
                key, sender, reply_to, transport=resend, sleep=lambda _: None
            ),
        )

    def _site(self, request: httpx.Request) -> httpx.Response:
        match = re.fullmatch(r"/this-week/(\d{4}-W\d{2})/data\.json", request.url.path)
        if match and match.group(1) in self.published:
            return httpx.Response(200, json=self.published[match.group(1)])
        # The frontend route answers 404 for every week that is not approved.
        return httpx.Response(404, json={"detail": "No approved roundup for this week"})

    def _resend(self, request: httpx.Request) -> httpx.Response:
        self.resend.append(request)
        return httpx.Response(200, json={"id": f"provider-{len(self.resend)}"})

    def approve(self, week: str) -> None:
        self.published[week] = roundup(week)
        self.ledger_weeks.add(week)

    def subscribe(self, email: str) -> dict:
        store = DigestStore(self.db)
        try:
            row, _ = store.prepare_subscription(email, now_ms=1)
            assert store.confirm(row["id"], row["token_nonce"], now_ms=2)
            return store.get_by_email(email)
        finally:
            store.close()

    def counts(self, week: str) -> dict[str, int]:
        store = DigestStore(self.db)
        try:
            return store.send_counts(week)
        finally:
            store.close()

    def run(self, *args: str) -> tuple[int, str, str]:
        """One workflow dispatch: a fresh process with a fresh connection."""

        self.capsys.readouterr()
        try:
            code = main(["send", *args, "--sample-dir", str(self.samples)])
        finally:
            if store_module._store is not None:
                store_module._store.close()
                store_module._store = None
        out, err = self.capsys.readouterr()
        return code, out, err

    def payloads(self) -> list[dict]:
        return [json.loads(request.content) for request in self.resend]


@pytest.fixture
def harness(tmp_path, monkeypatch, capsys, caplog):
    caplog.set_level(logging.INFO, logger="astro_finance.digest")
    return Harness(tmp_path, monkeypatch, capsys, caplog)


def test_a_second_dispatch_for_the_same_week_sends_nothing(harness):
    harness.approve(WEEK)
    one = harness.subscribe("one@example.com")
    two = harness.subscribe("two@example.com")

    code, out, _ = harness.run("--week", WEEK, "--send")
    assert code == 0
    assert "sent=2 failed=0 skipped=0 stuck=0" in out
    assert len(harness.resend) == 2
    assert {request.headers["idempotency-key"] for request in harness.resend} == {
        f"digest-{WEEK}-{one['id']}",
        f"digest-{WEEK}-{two['id']}",
    }
    assert harness.counts(WEEK) == {"sent": 2}

    # The same dispatch again (a re-run, or the schedule after a manual send).
    code, out, _ = harness.run("--week", WEEK, "--send")
    assert code == 0
    assert "eligible=0 already_sent=2 sent=0" in out
    assert len(harness.resend) == 2
    assert harness.counts(WEEK) == {"sent": 2}

    # A dry run afterwards reports the same state and still sends nothing.
    code, out, _ = harness.run("--week", WEEK, "--dry-run")
    assert code == 0
    assert "dry_run=1 recipients=2 eligible=0 already_sent=2 sent=0" in out
    assert len(harness.resend) == 2


@pytest.mark.parametrize(
    "state",
    ["not_published", "approved_false", "other_week", "no_ledger_line"],
)
@pytest.mark.parametrize(
    "mode",
    [("--send",), ("--dry-run",), ("--to", "owner@example.com")],
    ids=["send", "dry_run", "preview"],
)
def test_an_unapproved_week_sends_nothing(harness, state, mode):
    harness.subscribe("one@example.com")
    if state == "approved_false":
        # Belt and braces: even if the route served a draft, the reader refuses.
        harness.published[WEEK] = roundup(WEEK, approved=False)
        harness.ledger_weeks.add(WEEK)
    elif state == "other_week":
        harness.published[WEEK] = roundup("2026-W47")
        harness.ledger_weeks.add(WEEK)
    elif state == "no_ledger_line":
        harness.published[WEEK] = roundup(WEEK)

    code, out, err = harness.run("--week", WEEK, *mode)

    assert code == 1
    expected = (
        f"no ledger entry for {WEEK}"
        if state == "no_ledger_line"
        else f"no approved roundup for {WEEK}"
    )
    assert f"digest send failed: {expected}" in err
    assert out == ""
    assert harness.resend == []
    assert harness.counts(WEEK) == {}
    assert not harness.samples.exists()


def test_every_real_send_carries_a_working_one_click_unsubscribe(harness):
    harness.approve(WEEK)
    harness.subscribe("one@example.com")
    harness.subscribe("two@example.com")

    code, _, _ = harness.run("--week", WEEK, "--send")
    assert code == 0
    payloads = harness.payloads()
    assert len(payloads) == 2

    urls = []
    for payload in payloads:
        header = payload["headers"]["List-Unsubscribe"]
        assert header.startswith("<") and header.endswith(">")
        url = header[1:-1]
        assert url.startswith(f"{BASE}/api/digest/unsubscribe?t=")
        assert payload["headers"]["List-Unsubscribe-Post"] == "List-Unsubscribe=One-Click"
        # The same personal link is in the HTML footer and the text part.
        links = [
            unescape(href)
            for href, label in re.findall(
                r'<a href="([^"]+)"[^>]*>([^<]+)</a>', payload["html"]
            )
            if label == "Unsubscribe in one click"
        ]
        assert links == [url]
        assert f"Unsubscribe: {url}" in payload["text"]
        assert "1 Test Street, Test City" in payload["html"]
        assert "1 Test Street, Test City" in payload["text"]
        urls.append(url)
    assert len(set(urls)) == 2

    # RFC 8058: the mailbox provider POSTs the body below, with no cookies and
    # no Origin, to the List-Unsubscribe URL. That alone must unsubscribe.
    one_click = urls[0]
    store = DigestStore(harness.db)
    try:
        app = FastAPI()
        app.include_router(router, prefix="/api")
        router_module.get_store, original = (lambda: store), router_module.get_store
        try:
            client = TestClient(app)
            parts = urlsplit(one_click)
            response = client.post(
                f"{parts.path}?{parts.query}",
                content=b"List-Unsubscribe=One-Click",
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
        finally:
            router_module.get_store = original
        assert response.status_code == 200
        assert response.json() == {"status": "unsubscribed"}
        assert [row["email"] for row in store.active_subscribers()] == [
            "two@example.com"
        ]
    finally:
        store.close()

    # The next week reaches only the subscriber who stayed.
    harness.approve(NEXT_WEEK)
    code, out, _ = harness.run("--week", NEXT_WEEK, "--send")
    assert code == 0
    assert "recipients=1 eligible=1 already_sent=0 sent=1" in out
    assert harness.payloads()[-1]["to"] == ["two@example.com"]


def test_preview_goes_to_one_address_records_nothing_and_never_prints_it(harness):
    harness.approve(WEEK)
    harness.subscribe("one@example.com")
    address = "preview-owner@example.com"

    code, out, err = harness.run("--week", WEEK, "--to", address, "--preview-nonce", "42-1")

    assert code == 0
    assert len(harness.resend) == 1
    payload = harness.payloads()[0]
    assert payload["to"] == [address]
    assert payload["subject"].startswith("[Preview] StrikeHike weekly · ")
    assert payload["headers"]["List-Unsubscribe"].startswith(
        f"<{BASE}/api/digest/unsubscribe?t="
    )
    assert payload["headers"]["List-Unsubscribe-Post"] == "List-Unsubscribe=One-Click"
    assert "Unsubscribe in one click" in payload["html"]
    digest = hashlib.sha1(address.encode()).hexdigest()[:12]
    assert harness.resend[0].headers["idempotency-key"] == f"preview-{WEEK}-{digest}-42-1"
    # Not recorded, so the real send that follows still reaches everyone.
    assert harness.counts(WEEK) == {}
    # The address never reaches stdout, stderr or the log; the log is masked.
    for text in (out, err, harness.caplog.text):
        assert address not in text
    assert "p***@e***.com" in harness.caplog.text

    code, out, _ = harness.run("--week", WEEK, "--send")
    assert code == 0
    assert "sent=1" in out
    assert harness.payloads()[-1]["to"] == ["one@example.com"]


def test_a_preview_without_the_resend_key_fails_without_printing_the_address(
    harness, monkeypatch
):
    harness.approve(WEEK)
    monkeypatch.delenv("RESEND_API_KEY")
    address = "preview-owner@example.com"

    code, out, err = harness.run("--week", WEEK, "--to", address)

    assert code == 1
    assert "RESEND_API_KEY is not configured" in err
    assert address not in out + err + harness.caplog.text
    assert harness.resend == []
