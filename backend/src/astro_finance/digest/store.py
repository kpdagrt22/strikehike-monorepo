"""SQLite storage for digest subscribers and idempotent sends.

The file lives beside the analytics database on the same persistent volume
(``/app/data/runtime`` in Compose). It is intentionally separate: an email
address must never be joinable to an analytics event.
"""

from __future__ import annotations

import secrets
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any

from astro_finance.analytics.store import TokenBucket

from .settings import db_path

RESEND_AFTER_MS = 10 * 60 * 1000
SUBSCRIBE_LIMIT = 5
SUBSCRIBE_WINDOW_SECONDS = 60 * 60


class DigestStore:
    def __init__(self, path: str | Path | None = None):
        self.path = Path(path or db_path())
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(self.path, check_same_thread=False)
        self.connection.row_factory = sqlite3.Row
        self.connection.execute("PRAGMA journal_mode=WAL")
        self.connection.execute("PRAGMA busy_timeout=2000")
        self.connection.execute("PRAGMA synchronous=NORMAL")
        self.lock = threading.RLock()
        self.subscribe_limit = TokenBucket(
            SUBSCRIBE_LIMIT, SUBSCRIBE_WINDOW_SECONDS
        )
        self._create_schema()

    def _create_schema(self) -> None:
        with self.lock, self.connection:
            self.connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS subscribers (
                  id INTEGER PRIMARY KEY,
                  email TEXT NOT NULL UNIQUE,
                  status TEXT NOT NULL CHECK(status IN ('pending','active','unsubscribed')),
                  created_at INTEGER NOT NULL,
                  confirmed_at INTEGER,
                  unsubscribed_at INTEGER,
                  token_nonce TEXT NOT NULL,
                  last_sent_at INTEGER
                );
                CREATE INDEX IF NOT EXISTS idx_digest_subscribers_status
                  ON subscribers(status);
                CREATE TABLE IF NOT EXISTS sends (
                  id INTEGER PRIMARY KEY,
                  subscriber_id INTEGER NOT NULL,
                  week TEXT NOT NULL,
                  sent_at INTEGER,
                  provider_id TEXT,
                  status TEXT NOT NULL,
                  UNIQUE(subscriber_id, week)
                );
                CREATE INDEX IF NOT EXISTS idx_digest_sends_week ON sends(week);
                """
            )

    def close(self) -> None:
        with self.lock:
            self.connection.close()

    @staticmethod
    def _row(row: sqlite3.Row | None) -> dict[str, Any] | None:
        return dict(row) if row is not None else None

    def get_by_email(self, email: str) -> dict[str, Any] | None:
        with self.lock:
            return self._row(
                self.connection.execute(
                    "SELECT * FROM subscribers WHERE email=?", (email,)
                ).fetchone()
            )

    def get_by_id(self, subscriber_id: int) -> dict[str, Any] | None:
        with self.lock:
            return self._row(
                self.connection.execute(
                    "SELECT * FROM subscribers WHERE id=?", (subscriber_id,)
                ).fetchone()
            )

    def prepare_subscription(
        self,
        email: str,
        now_ms: int | None = None,
        *,
        resend_after_ms: int = RESEND_AFTER_MS,
    ) -> tuple[dict[str, Any], bool]:
        """Create or refresh a pending subscriber.

        Returns ``(row, should_send)``. A pending address is only re-sent after
        ten minutes; an active address is never mailed a second confirmation.
        An unsubscribed address starts a fresh double opt-in with a new nonce.
        """

        now = int(time.time() * 1000) if now_ms is None else int(now_ms)
        with self.lock, self.connection:
            row = self.connection.execute(
                "SELECT * FROM subscribers WHERE email=?", (email,)
            ).fetchone()
            if row is None:
                nonce = secrets.token_urlsafe(24)
                cursor = self.connection.execute(
                    "INSERT INTO subscribers("
                    "email, status, created_at, token_nonce, last_sent_at"
                    ") VALUES(?, 'pending', ?, ?, ?)",
                    (email, now, nonce, now),
                )
                row = self.connection.execute(
                    "SELECT * FROM subscribers WHERE id=?", (cursor.lastrowid,)
                ).fetchone()
                return dict(row), True

            current = dict(row)
            if current["status"] == "active":
                return current, False
            if current["status"] == "pending":
                last = int(current.get("last_sent_at") or 0)
                if now - last < resend_after_ms:
                    return current, False
                self.connection.execute(
                    "UPDATE subscribers SET last_sent_at=? WHERE id=?",
                    (now, current["id"]),
                )
                current["last_sent_at"] = now
                return current, True

            # Unsubscribed: a new double opt-in is allowed. The new nonce
            # invalidates the old confirm and unsubscribe links.
            nonce = secrets.token_urlsafe(24)
            self.connection.execute(
                "UPDATE subscribers SET status='pending', token_nonce=?, "
                "confirmed_at=NULL, unsubscribed_at=NULL, last_sent_at=? "
                "WHERE id=?",
                (nonce, now, current["id"]),
            )
            row = self.connection.execute(
                "SELECT * FROM subscribers WHERE id=?", (current["id"],)
            ).fetchone()
            return dict(row), True

    def confirm(
        self, subscriber_id: int, nonce: str, now_ms: int | None = None
    ) -> bool:
        now = int(time.time() * 1000) if now_ms is None else int(now_ms)
        with self.lock, self.connection:
            row = self.connection.execute(
                "SELECT * FROM subscribers WHERE id=?", (subscriber_id,)
            ).fetchone()
            if row is None or not secrets.compare_digest(
                str(row["token_nonce"]), str(nonce)
            ):
                return False
            if row["status"] == "active":
                return True
            if row["status"] != "pending":
                return False
            self.connection.execute(
                "UPDATE subscribers SET status='active', confirmed_at=? WHERE id=?",
                (now, subscriber_id),
            )
            return True

    def unsubscribe(
        self, subscriber_id: int, nonce: str, now_ms: int | None = None
    ) -> bool:
        now = int(time.time() * 1000) if now_ms is None else int(now_ms)
        with self.lock, self.connection:
            row = self.connection.execute(
                "SELECT * FROM subscribers WHERE id=?", (subscriber_id,)
            ).fetchone()
            if row is None or not secrets.compare_digest(
                str(row["token_nonce"]), str(nonce)
            ):
                return False
            if row["status"] == "unsubscribed":
                return True
            self.connection.execute(
                "UPDATE subscribers SET status='unsubscribed', unsubscribed_at=? "
                "WHERE id=?",
                (now, subscriber_id),
            )
            return True

    def active_subscribers(self) -> list[dict[str, Any]]:
        with self.lock:
            return [
                dict(row)
                for row in self.connection.execute(
                    "SELECT * FROM subscribers WHERE status='active' ORDER BY id"
                ).fetchall()
            ]

    def send_exists(self, subscriber_id: int, week: str) -> bool:
        with self.lock:
            row = self.connection.execute(
                "SELECT 1 FROM sends WHERE subscriber_id=? AND week=?",
                (subscriber_id, week),
            ).fetchone()
            return row is not None

    def reserve_send(
        self, subscriber_id: int, week: str, now_ms: int | None = None
    ) -> bool:
        """Claim (subscriber, week) before the provider call.

        The UNIQUE constraint is the idempotency lock: a second run, or a
        concurrent one, cannot claim the same pair.
        """

        now = int(time.time() * 1000) if now_ms is None else int(now_ms)
        with self.lock, self.connection:
            cursor = self.connection.execute(
                "INSERT OR IGNORE INTO sends("
                "subscriber_id, week, sent_at, status"
                ") VALUES(?,?,?,'sending')",
                (subscriber_id, week, now),
            )
            return cursor.rowcount == 1

    def mark_send(
        self,
        subscriber_id: int,
        week: str,
        status: str,
        provider_id: str | None = None,
        now_ms: int | None = None,
    ) -> None:
        now = int(time.time() * 1000) if now_ms is None else int(now_ms)
        with self.lock, self.connection:
            self.connection.execute(
                "UPDATE sends SET status=?, provider_id=?, sent_at=? "
                "WHERE subscriber_id=? AND week=?",
                (status, provider_id, now, subscriber_id, week),
            )

    def send_counts(self, week: str) -> dict[str, int]:
        with self.lock:
            rows = self.connection.execute(
                "SELECT status, COUNT(*) AS count FROM sends WHERE week=? "
                "GROUP BY status",
                (week,),
            ).fetchall()
        return {str(row["status"]): int(row["count"]) for row in rows}


_store: DigestStore | None = None
_store_lock = threading.Lock()


def get_store(path: str | Path | None = None) -> DigestStore:
    global _store
    with _store_lock:
        if _store is None or (path is not None and Path(path) != _store.path):
            _store = DigestStore(path)
        return _store
