"""Weekly digest sender and CLI.

Default is a dry run: render one sample, count recipients, write nothing to
Resend. A real send requires ``--send`` and ``DIGEST_POSTAL_ADDRESS``.
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable
from urllib.parse import quote

from . import settings
from .content import RoundupError, fetch_roundup
from .mailer import Mail, ResendAuthError, ResendMailer
from .privacy import mask_email
from .render import render_roundup
from .store import DigestStore, get_store
from .tokens import sign_token
from astro_finance.ledger.store import fetch_ledger_entry

logger = logging.getLogger("astro_finance.digest")


class SendError(RuntimeError):
    pass


@dataclass
class SendResult:
    week: str
    dry_run: bool
    recipients: int = 0
    eligible: int = 0
    already_sent: int = 0
    sent: int = 0
    failed: int = 0
    skipped: int = 0
    stuck: int = 0
    sample_email: str | None = None
    sample_html: str | None = None
    sample_text: str | None = None


def _unsubscribe_url(subscriber: dict[str, Any], secret: str) -> str:
    token = sign_token(
        secret,
        "unsub",
        int(subscriber.get("id") or 1),
        str(subscriber.get("token_nonce") or "sample"),
    )
    return (
        f"{settings.base_url()}/api/digest/unsubscribe?t={quote(token, safe='')}"
    )


def send_week(
    week: str,
    *,
    dry_run: bool = True,
    limit: int | None = None,
    store: DigestStore | None = None,
    mailer: ResendMailer | None = None,
    fetch: Callable[[str], dict] | None = None,
    now_ms: int | None = None,
    sample_dir: str | Path | None = None,
    ledger: dict[str, Any] | None = None,
) -> SendResult:
    if limit is not None and limit < 1:
        raise SendError("--limit must be at least 1")
    store = store or get_store()
    fetch = fetch or fetch_roundup
    secret = settings.token_secret()
    if not secret:
        raise SendError("DIGEST_TOKEN_SECRET is not configured")

    roundup = fetch(week)
    if ledger is None:
        ledger = fetch_ledger_entry(week)
    if not ledger:
        raise SendError(
            f"no ledger entry for {week}; append it before sending"
        )
    subscribers = store.active_subscribers()
    eligible = []
    already_sent = 0
    stuck = 0
    for subscriber in subscribers:
        row = store.get_send(int(subscriber["id"]), week)
        if row is None or row["status"] == "failed":
            eligible.append(subscriber)
        elif row["status"] == "sending":
            # A crash left this claim behind. Do not retry it automatically:
            # the provider may already have accepted the message.
            stuck += 1
        else:
            already_sent += 1
    if limit is not None:
        eligible = eligible[:limit]

    result = SendResult(
        week=week,
        dry_run=dry_run,
        recipients=len(subscribers),
        eligible=len(eligible),
        already_sent=already_sent,
        stuck=stuck,
    )

    if dry_run:
        sample = (
            eligible[0]
            if eligible
            else {
                "id": 1,
                "email": "sample@example.com",
                "token_nonce": "sample-nonce",
            }
        )
        # A dry-run sample is never sent, so it carries a visible placeholder
        # rather than a working token for a real subscriber.
        unsubscribe_url = (
            f"{settings.base_url()}/api/digest/unsubscribe?t=sample-token"
        )
        postal = settings.postal_address() or "Postal address not set (dry run)"
        rendered = render_roundup(
            roundup,
            unsubscribe_url=unsubscribe_url,
            postal_address=postal,
            base_url=settings.base_url(),
            ledger=ledger,
        )
        directory = Path(
            sample_dir
            or os.environ.get("DIGEST_SAMPLE_DIR", "digest-samples")
        )
        directory.mkdir(parents=True, exist_ok=True)
        html_path = directory / f"digest-{week}.html"
        text_path = directory / f"digest-{week}.txt"
        html_path.write_text(rendered.html, encoding="utf-8")
        text_path.write_text(rendered.text, encoding="utf-8")
        result.sample_email = mask_email(str(sample.get("email") or ""))
        result.sample_html = str(html_path)
        result.sample_text = str(text_path)
        logger.info(
            "digest dry run week=%s recipients=%s eligible=%s already_sent=%s stuck=%s sample=%s",
            week,
            result.recipients,
            result.eligible,
            result.already_sent,
            result.stuck,
            result.sample_email,
        )
        return result

    postal = settings.postal_address()
    if not postal:
        raise SendError(
            "DIGEST_POSTAL_ADDRESS is required for a real send; use --dry-run first"
        )
    if mailer is None:
        mailer = ResendMailer(
            settings.resend_api_key(),
            settings.from_address(),
            settings.reply_to(),
        )

    for subscriber in eligible:
        subscriber_id = int(subscriber["id"])
        reserved = store.reserve_send(
            subscriber_id,
            week,
            int(time.time() * 1000) if now_ms is None else now_ms,
        )
        if not reserved:
            result.skipped += 1
            continue
        unsubscribe_url = _unsubscribe_url(subscriber, secret)
        rendered = render_roundup(
            roundup,
            unsubscribe_url=unsubscribe_url,
            postal_address=postal,
            base_url=settings.base_url(),
            ledger=ledger,
        )
        mail = Mail(
            to=str(subscriber["email"]),
            subject=rendered.subject,
            html=rendered.html,
            text=rendered.text,
            headers={
                "List-Unsubscribe": f"<{unsubscribe_url}>",
                "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
            },
            from_address=settings.from_address(),
            reply_to=settings.reply_to(),
            idempotency_key=f"digest-{week}-{subscriber_id}",
        )
        try:
            provider_id = mailer.send(mail)
        except ResendAuthError as exc:
            store.mark_send(subscriber_id, week, "failed", None)
            result.failed += 1
            logger.error(
                "digest send stopped week=%s status=%s masked=%s",
                week,
                exc.status,
                mask_email(str(subscriber["email"])),
            )
            break
        except Exception as exc:  # noqa: BLE001 - recorded, never raised with PII
            store.mark_send(subscriber_id, week, "failed", None)
            result.failed += 1
            logger.error(
                "digest send failed week=%s masked=%s error=%s",
                week,
                mask_email(str(subscriber["email"])),
                type(exc).__name__,
            )
            continue
        store.mark_send(subscriber_id, week, "sent", provider_id)
        result.sent += 1

    logger.info(
        "digest send week=%s recipients=%s eligible=%s sent=%s failed=%s skipped=%s stuck=%s",
        week,
        result.recipients,
        result.eligible,
        result.sent,
        result.failed,
        result.skipped,
        result.stuck,
    )
    return result


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m astro_finance.digest",
        description="Render or send the approved weekly StrikeHike digest.",
    )
    commands = parser.add_subparsers(dest="command", required=True)
    send = commands.add_parser("send", help="render or send one ISO week")
    send.add_argument("--week", required=True, help="ISO week, for example 2026-W47")
    send.add_argument(
        "--dry-run",
        action="store_true",
        default=True,
        help="render and count only (the default)",
    )
    send.add_argument(
        "--send",
        dest="dry_run",
        action="store_false",
        help="send through Resend (requires DIGEST_POSTAL_ADDRESS)",
    )
    send.add_argument("--limit", type=int, default=None, help="send to at most N people")
    send.add_argument(
        "--sample-dir",
        default=None,
        help="where the dry-run HTML and text samples are written",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    if args.command != "send":
        return 2
    try:
        result = send_week(
            args.week,
            dry_run=args.dry_run,
            limit=args.limit,
            sample_dir=args.sample_dir,
        )
    except (RoundupError, SendError, ValueError) as exc:
        print(f"digest send failed: {exc}", file=sys.stderr)
        return 1
    print(
        "week={week} dry_run={dry_run} recipients={recipients} "
        "eligible={eligible} already_sent={already_sent} sent={sent} "
        "failed={failed} skipped={skipped} stuck={stuck}".format(
            week=result.week,
            dry_run=1 if result.dry_run else 0,
            recipients=result.recipients,
            eligible=result.eligible,
            already_sent=result.already_sent,
            sent=result.sent,
            failed=result.failed,
            skipped=result.skipped,
            stuck=result.stuck,
        )
    )
    if result.sample_email:
        print(f"sample={result.sample_email}")
    if result.sample_html:
        print(f"html={result.sample_html}")
    if result.sample_text:
        print(f"text={result.sample_text}")
    return 0
