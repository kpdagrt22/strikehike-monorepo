"""SQLite storage and in-memory abuse limits for first-party measurement."""

from __future__ import annotations

import json
import os
import sqlite3
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable
from zoneinfo import ZoneInfo

from .schema import load_schema

IST = ZoneInfo("Asia/Kolkata")
DEFAULT_DB = "/app/data/runtime/analytics/analytics.sqlite"
GLOBAL_DAILY_CAP = 50_000
# Per masked network (/24 or /48), per minute. Mobile carriers put many
# visitors behind one /48, so this is an abuse ceiling, not a per-person cap.
NET_REQUESTS_PER_MINUTE = 600
RETENTION_DAYS = 395


def _day(value: datetime) -> str:
    return value.astimezone(IST).date().isoformat()


def _week(value: datetime) -> str:
    iso = value.astimezone(IST).isocalendar()
    return f"{iso.year}-W{iso.week:02d}"


def _device(width: int) -> str:
    return "phone" if width < 640 else "tablet" if width < 1024 else "desktop"


# IANA zones of the United States (zone1970.tab, plus common links).
US_ZONES = frozenset(
    """America/New_York America/Detroit America/Kentucky/Louisville
    America/Kentucky/Monticello America/Indiana/Indianapolis America/Indiana/Vincennes
    America/Indiana/Winamac America/Indiana/Marengo America/Indiana/Petersburg
    America/Indiana/Vevay America/Indiana/Tell_City America/Indiana/Knox
    America/Chicago America/Menominee America/North_Dakota/Center
    America/North_Dakota/New_Salem America/North_Dakota/Beulah America/Denver
    America/Boise America/Phoenix America/Los_Angeles America/Anchorage
    America/Juneau America/Sitka America/Metlakatla America/Yakutat America/Nome
    America/Adak Pacific/Honolulu America/Indianapolis America/Louisville
    America/Fort_Wayne America/Knox_IN America/Shiprock America/Atka
    US/Eastern US/Central US/Mountain US/Pacific US/Alaska US/Hawaii US/Arizona
    US/East-Indiana US/Indiana-Starke US/Michigan US/Aleutian""".split()
)
# Capitals and other zones of the 27 EU member states.
EU_ZONES = frozenset(
    """Europe/Vienna Europe/Brussels Europe/Sofia Europe/Zagreb Asia/Nicosia
    Asia/Famagusta Europe/Nicosia Europe/Prague Europe/Copenhagen Europe/Tallinn
    Europe/Helsinki Europe/Mariehamn Europe/Paris Europe/Berlin Europe/Busingen
    Europe/Athens Europe/Budapest Europe/Dublin Europe/Rome Europe/Riga
    Europe/Vilnius Europe/Luxembourg Europe/Malta Europe/Amsterdam Europe/Warsaw
    Europe/Lisbon Atlantic/Azores Atlantic/Madeira Europe/Bucharest
    Europe/Bratislava Europe/Ljubljana Europe/Madrid Africa/Ceuta
    Atlantic/Canary Europe/Stockholm""".split()
)


def _geo(tz: str) -> str:
    if not tz:
        return "unknown"
    if tz in {"Asia/Kolkata", "Asia/Calcutta"}:
        return "IN"
    if tz in {"Europe/London", "Europe/Belfast", "GB"}:
        return "UK"
    if tz in EU_ZONES:
        return "EU"
    if tz in US_ZONES:
        return "US"
    return "other"


def _families(ua: str) -> tuple[str, str]:
    value = (ua or "").lower()
    browser = (
        "edge"
        if "edg" in value
        else "chrome"
        if "chrome" in value or "crios" in value
        else "firefox"
        if "firefox" in value
        else "safari"
        if "safari" in value
        else "other"
    )
    system = (
        "windows"
        if "windows" in value
        else "android"
        if "android" in value
        else "ios"
        if "iphone" in value or "ipad" in value
        else "macos"
        if "mac os" in value
        else "linux"
        if "linux" in value
        else "other"
    )
    return browser, system


def _matches(host: str, values: Iterable[str]) -> bool:
    return any(host == value or host.endswith("." + value) for value in values)


def _referrer_class(props: dict[str, Any]) -> str | None:
    medium = str(props.get("utm_medium") or "").lower()
    if medium in {"calendar", "feed", "email", "community", "social"}:
        return medium
    if medium in {"copy_link", "native"}:
        return "share"
    if medium == "referral":
        return "referral"
    host = str(props.get("referrer_host") or "").lower()
    if not host:
        return "direct" if props.get("landing") == 1 else None
    if _matches(host, ("google.com", "bing.com", "duckduckgo.com", "search.yahoo.com", "ecosia.org", "search.brave.com", "startpage.com", "baidu.com", "naver.com")) or host.startswith(("google.", "yandex.")):
        return "search"
    if _matches(host, ("chatgpt.com", "chat.openai.com", "perplexity.ai", "gemini.google.com", "copilot.microsoft.com", "claude.ai")):
        return "ai_assistant"
    if _matches(host, ("news.ycombinator.com", "reddit.com", "old.reddit.com", "lobste.rs", "indiehackers.com")):
        return "community"
    if _matches(host, ("linkedin.com", "lnkd.in", "x.com", "t.co", "twitter.com", "facebook.com", "bsky.app", "threads.net", "youtube.com")) or host.startswith("mastodon."):
        return "social"
    if _matches(host, ("calendar.google.com", "outlook.live.com", "outlook.office.com")):
        return "calendar"
    if _matches(host, ("strikehike.com",)):
        return "internal"
    return "referral"


def referrer_class(props: dict[str, Any]) -> str | None:
    """Public reuse of the §7.3 classifier for server-log aggregation."""
    return _referrer_class(props)


class TokenBucket:
    """A small in-memory token bucket; tests can advance its clock."""

    MAX_KEYS = 20_000

    def __init__(self, capacity: int, window_seconds: float):
        self.capacity = float(capacity)
        self.rate = capacity / window_seconds
        self.window = float(window_seconds)
        self.buckets: dict[str, tuple[float, float]] = {}
        self.lock = threading.Lock()

    def _sweep(self, current: float) -> None:
        # A key idle for a whole window is back at full capacity: forget it.
        idle = [k for k, (_, at) in self.buckets.items() if current - at >= self.window]
        for key in idle:
            del self.buckets[key]
        # Still too many (a burst of fresh keys): drop the oldest half.
        if len(self.buckets) >= self.MAX_KEYS:
            ordered = sorted(self.buckets, key=lambda k: self.buckets[k][1])
            for key in ordered[: len(ordered) // 2]:
                del self.buckets[key]

    def take(self, key: str, amount: int, now: float | None = None) -> bool:
        with self.lock:
            current = time.time() if now is None else now
            if key not in self.buckets and len(self.buckets) >= self.MAX_KEYS:
                self._sweep(current)
            tokens, updated = self.buckets.get(key, (self.capacity, current))
            tokens = min(self.capacity, tokens + (current - updated) * self.rate)
            if tokens < amount:
                self.buckets[key] = (tokens, current)
                return False
            self.buckets[key] = (tokens - amount, current)
            return True


class DailyCounter:
    def __init__(self, capacity: int):
        self.capacity = capacity
        self.counts: dict[str, tuple[str, int]] = {}
        self.lock = threading.Lock()

    MAX_KEYS = 20_000

    def take(self, key: str, amount: int, day: str) -> bool:
        with self.lock:
            if key not in self.counts and len(self.counts) >= self.MAX_KEYS:
                # Yesterday's counts no longer limit anything.
                self.counts = {k: v for k, v in self.counts.items() if v[0] == day}
                if len(self.counts) >= self.MAX_KEYS:
                    self.counts.clear()
            current_day, count = self.counts.get(key, (day, 0))
            if current_day != day:
                count = 0
            if count + amount > self.capacity:
                self.counts[key] = (day, count)
                return False
            self.counts[key] = (day, count + amount)
            return True


class AnalyticsStore:
    def __init__(self, path: str | Path | None = None):
        self.path = Path(path or os.environ.get("ANALYTICS_DB", DEFAULT_DB))
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(self.path, check_same_thread=False)
        self.connection.row_factory = sqlite3.Row
        self.connection.execute("PRAGMA journal_mode=WAL")
        self.connection.execute("PRAGMA busy_timeout=2000")
        self.connection.execute("PRAGMA synchronous=NORMAL")
        self.lock = threading.RLock()
        self.net_limit = TokenBucket(NET_REQUESTS_PER_MINUTE, 60)
        self.aid_minute = TokenBucket(60, 60)
        self.aid_day = DailyCounter(1_500)
        self.feedback_limit = TokenBucket(5, 3_600)
        self.schema = load_schema()
        self._create_schema()

    def _create_schema(self) -> None:
        with self.lock, self.connection:
            self.connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS events (
                  id INTEGER PRIMARY KEY,
                  received_at INTEGER NOT NULL,
                  client_ts INTEGER NOT NULL,
                  day_ist TEXT NOT NULL,
                  week_ist TEXT NOT NULL,
                  anon_id TEXT NOT NULL,
                  session_id TEXT NOT NULL,
                  pv_id TEXT NOT NULL,
                  name TEXT NOT NULL,
                  path TEXT NOT NULL,
                  props TEXT NOT NULL,
                  visible_ms INTEGER,
                  rum_lcp_ms INTEGER,
                  rum_inp_ms INTEGER,
                  rum_cls_x1000 INTEGER,
                  landing INTEGER NOT NULL DEFAULT 0,
                  referrer_class TEXT,
                  referrer_host TEXT,
                  utm_source TEXT,
                  utm_medium TEXT,
                  utm_campaign TEXT,
                  utm_content TEXT,
                  device_class TEXT NOT NULL,
                  browser_family TEXT NOT NULL,
                  os_family TEXT NOT NULL,
                  geo_bucket TEXT NOT NULL,
                  is_new_id INTEGER NOT NULL DEFAULT 0,
                  ephemeral INTEGER NOT NULL DEFAULT 0,
                  exp TEXT,
                  app_version TEXT NOT NULL,
                  schema_version INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_analytics_day ON events(day_ist);
                CREATE INDEX IF NOT EXISTS idx_analytics_week_name ON events(week_ist, name);
                CREATE INDEX IF NOT EXISTS idx_analytics_aid_day ON events(anon_id, day_ist);
                CREATE INDEX IF NOT EXISTS idx_analytics_session ON events(session_id);
                CREATE INDEX IF NOT EXISTS idx_analytics_pv ON events(pv_id);
                CREATE TABLE IF NOT EXISTS ingest_stats (
                  day_ist TEXT PRIMARY KEY,
                  accepted INTEGER NOT NULL DEFAULT 0,
                  dropped_bot INTEGER NOT NULL DEFAULT 0,
                  dropped_rate INTEGER NOT NULL DEFAULT 0,
                  dropped_schema INTEGER NOT NULL DEFAULT 0,
                  dropped_origin INTEGER NOT NULL DEFAULT 0,
                  dropped_size INTEGER NOT NULL DEFAULT 0,
                  stripped_props INTEGER NOT NULL DEFAULT 0,
                  global_cap_hit INTEGER NOT NULL DEFAULT 0
                );
                CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS feedback (
                  id INTEGER PRIMARY KEY,
                  received_at INTEGER NOT NULL,
                  day_ist TEXT NOT NULL,
                  path TEXT NOT NULL,
                  message TEXT NOT NULL,
                  app_version TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_feedback_day ON feedback(day_ist);
                """
            )
            self.connection.execute(
                "INSERT OR IGNORE INTO meta(key, value) VALUES('schema_version', '1')"
            )

    def close(self) -> None:
        with self.lock:
            self.connection.close()

    def _stat(self, day: str, **increments: int) -> None:
        columns = {
            "accepted",
            "dropped_bot",
            "dropped_rate",
            "dropped_schema",
            "dropped_origin",
            "dropped_size",
            "stripped_props",
            "global_cap_hit",
        }
        values = {key: int(value) for key, value in increments.items() if key in columns}
        if not values:
            return
        self.connection.execute(
            "INSERT OR IGNORE INTO ingest_stats(day_ist) VALUES(?)", (day,)
        )
        assignments = ", ".join(f"{key}={key}+?" for key in values)
        self.connection.execute(
            f"UPDATE ingest_stats SET {assignments} WHERE day_ist=?",
            (*values.values(), day),
        )

    def record_drop(self, kind: str, count: int, now: datetime | None = None) -> None:
        day = _day(now or datetime.now(timezone.utc))
        with self.lock, self.connection:
            self._stat(day, **{f"dropped_{kind}": count})

    def _purge(self, day: str, now_ms: int) -> None:
        row = self.connection.execute(
            "SELECT value FROM meta WHERE key='last_purge_day'"
        ).fetchone()
        if row and row["value"] == day:
            return
        cutoff = now_ms - RETENTION_DAYS * 86_400_000
        self.connection.execute("DELETE FROM events WHERE received_at < ?", (cutoff,))
        self.connection.execute("DELETE FROM feedback WHERE received_at < ?", (cutoff,))
        self.connection.execute(
            "INSERT INTO meta(key, value) VALUES('last_purge_day', ?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (day,),
        )

    def ingest(
        self,
        envelope: dict[str, Any],
        events: list[dict[str, Any]],
        vis: list[dict[str, Any]],
        user_agent: str,
        net_key: str,
        now_ms: int | None = None,
        stripped_props: int = 0,
    ) -> dict[str, Any]:
        now_ms = int(time.time() * 1000) if now_ms is None else int(now_ms)
        moment = datetime.fromtimestamp(now_ms / 1000, tz=timezone.utc)
        day = _day(moment)
        week = _week(moment)
        count = len(events)
        if not self.net_limit.take(net_key, 1, now_ms / 1000):
            self.record_drop("rate", count, moment)
            return {"accepted": 0, "dropped_rate": count}
        if count and not self.aid_minute.take(envelope["aid"], count, now_ms / 1000):
            self.record_drop("rate", count, moment)
            return {"accepted": 0, "dropped_rate": count}
        if count and not self.aid_day.take(envelope["aid"], count, day):
            self.record_drop("rate", count, moment)
            return {"accepted": 0, "dropped_rate": count}

        with self.lock, self.connection:
            self._purge(day, now_ms)
            accepted_row = self.connection.execute(
                "SELECT accepted FROM ingest_stats WHERE day_ist=?", (day,)
            ).fetchone()
            accepted = int(accepted_row["accepted"]) if accepted_row else 0
            room = max(0, GLOBAL_DAILY_CAP - accepted)
            kept = events[:room]
            dropped_cap = len(events) - len(kept)

            browser, system = _families(user_agent)
            device = _device(int(envelope["vw"]))
            geo = _geo(str(envelope["tz"]))
            rows = []
            for event in kept:
                props = event["props"]
                landing = 1 if event["name"] == "page_viewed" and props.get("landing") == 1 else 0
                rows.append(
                    (
                        now_ms,
                        event["client_ts"],
                        day,
                        week,
                        envelope["aid"],
                        envelope["sid"],
                        event["pv_id"],
                        event["name"],
                        event["path"],
                        json.dumps(props, separators=(",", ":"), ensure_ascii=False),
                        None,
                        None,
                        None,
                        None,
                        landing,
                        _referrer_class(props) if landing else None,
                        props.get("referrer_host"),
                        props.get("utm_source"),
                        props.get("utm_medium"),
                        props.get("utm_campaign"),
                        props.get("utm_content"),
                        device,
                        browser,
                        system,
                        geo,
                        int(envelope["new"]),
                        int(envelope["eph"]),
                        json.dumps(envelope["exp"], separators=(",", ":")),
                        envelope["app"],
                        int(self.schema["schema_version"]),
                    )
                )
            self.connection.executemany(
                """
                INSERT INTO events(
                  received_at, client_ts, day_ist, week_ist, anon_id, session_id,
                  pv_id, name, path, props, visible_ms, rum_lcp_ms, rum_inp_ms,
                  rum_cls_x1000, landing, referrer_class, referrer_host,
                  utm_source, utm_medium, utm_campaign, utm_content, device_class,
                  browser_family, os_family, geo_bucket, is_new_id, ephemeral,
                  exp, app_version, schema_version
                ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                """,
                rows,
            )
            for update in vis:
                self.connection.execute(
                    """
                    UPDATE events SET
                      visible_ms=MAX(COALESCE(visible_ms,0), ?),
                      rum_lcp_ms=CASE WHEN ? IS NULL THEN rum_lcp_ms
                        ELSE MAX(COALESCE(rum_lcp_ms,0), ?) END,
                      rum_inp_ms=CASE WHEN ? IS NULL THEN rum_inp_ms
                        ELSE MAX(COALESCE(rum_inp_ms,0), ?) END,
                      rum_cls_x1000=CASE WHEN ? IS NULL THEN rum_cls_x1000
                        ELSE MAX(COALESCE(rum_cls_x1000,0), ?) END
                    WHERE pv_id=? AND anon_id=? AND name='page_viewed'
                    """,
                    (
                        update["ms"],
                        update.get("lcp"),
                        update.get("lcp"),
                        update.get("inp"),
                        update.get("inp"),
                        update.get("cls"),
                        update.get("cls"),
                        update["pv"],
                        envelope["aid"],
                    ),
                )
            self._stat(
                day,
                accepted=len(kept),
                stripped_props=stripped_props,
                global_cap_hit=1 if dropped_cap else 0,
            )
            self.connection.commit()
        return {"accepted": len(kept), "dropped_global_cap": dropped_cap}

    def add_feedback(
        self,
        message: str,
        path: str,
        app_version: str,
        net_key: str,
        now_ms: int | None = None,
    ) -> bool:
        now_ms = int(time.time() * 1000) if now_ms is None else int(now_ms)
        moment = datetime.fromtimestamp(now_ms / 1000, tz=timezone.utc)
        if not self.feedback_limit.take(net_key, 1, now_ms / 1000):
            return False
        with self.lock, self.connection:
            self.connection.execute(
                "INSERT INTO feedback(received_at, day_ist, path, message, app_version) "
                "VALUES(?,?,?,?,?)",
                (now_ms, _day(moment), path[:128], message, app_version[:7]),
            )
            self.connection.commit()
        return True

    def delete_aid(self, aid: str) -> int:
        with self.lock, self.connection:
            cursor = self.connection.execute(
                "DELETE FROM events WHERE anon_id=?", (aid,)
            )
            self.connection.commit()
            return int(cursor.rowcount)

    def stats_week(self, week: str) -> dict[str, Any]:
        year, number = week.split("-W")
        start = datetime.fromisocalendar(int(year), int(number), 1).date()
        end = start + timedelta(days=6)
        with self.lock:
            by_event = [
                dict(row)
                for row in self.connection.execute(
                    "SELECT name, COUNT(*) AS count FROM events "
                    "WHERE week_ist=? GROUP BY name ORDER BY name",
                    (week,),
                )
            ]
            by_day = [
                dict(row)
                for row in self.connection.execute(
                    "SELECT day_ist, COUNT(*) AS count FROM events "
                    "WHERE week_ist=? GROUP BY day_ist ORDER BY day_ist",
                    (week,),
                )
            ]
            stats = [
                dict(row)
                for row in self.connection.execute(
                    "SELECT * FROM ingest_stats WHERE day_ist BETWEEN ? AND ? "
                    "ORDER BY day_ist",
                    (start.isoformat(), end.isoformat()),
                )
            ]
        return {"week": week, "by_event": by_event, "by_day": by_day, "ingest_stats": stats}

    def feedback_rows(self, since: str | None = None) -> list[dict[str, Any]]:
        query = "SELECT * FROM feedback"
        params: tuple[Any, ...] = ()
        if since:
            query += " WHERE day_ist >= ?"
            params = (since,)
        query += " ORDER BY received_at"
        with self.lock:
            return [dict(row) for row in self.connection.execute(query, params)]


_store: AnalyticsStore | None = None
_store_lock = threading.Lock()


def get_store(path: str | Path | None = None) -> AnalyticsStore:
    global _store
    with _store_lock:
        if _store is None or (path is not None and Path(path) != _store.path):
            _store = AnalyticsStore(path)
        return _store
