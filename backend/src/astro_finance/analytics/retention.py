"""The analytics retention purge on a clock, not only on traffic.

AnalyticsStore drops rows older than RETENTION_DAYS (395) on the first write of
an IST day (a beacon or a CSP report). A day with neither skipped it, so a row
could outlive the window by the length of a traffic gap. The backend therefore
runs the same purge when it starts and checks again every hour. The purge still
runs at most once per IST day (meta.last_purge_day) inside the store lock, so
the hourly check deletes once a day, within the first hour after IST midnight,
and a write later that day finds it done. RETENTION_DAYS and CSP_DAILY_CAP are
unchanged.
"""

from __future__ import annotations

import asyncio
import contextlib
import os
from pathlib import Path

from fastapi import FastAPI

from . import store as store_module

PURGE_CHECK_SECONDS = 60 * 60


def purge_if_due(now_ms: int | None = None) -> bool | None:
    """Run today's purge if no write has run it. None when there is no database.

    Never creates the database: no analytics file means nothing to purge. Uses
    the shared store (get_store), so it holds the same lock as every write.
    """
    path = Path(os.environ.get("ANALYTICS_DB", store_module.DEFAULT_DB))
    if not path.exists():
        return None
    return store_module.get_store().purge_expired(now_ms)


async def purge_loop(interval: float = PURGE_CHECK_SECONDS) -> None:
    """Purge now, then check every `interval` seconds, until cancelled."""
    while True:
        try:
            # SQLite may wait on its busy timeout: never on the event loop.
            if await asyncio.to_thread(purge_if_due):
                print("[ok] analytics retention purge ran")
        except Exception as exc:  # noqa: BLE001 - a failed purge must not stop the timer
            print(f"[warn] analytics retention purge failed: {exc}")
        await asyncio.sleep(interval)


def install(app: FastAPI, interval: float = PURGE_CHECK_SECONDS) -> None:
    """Start the purge timer with the app; stop it on shutdown."""
    tasks: list[asyncio.Task[None]] = []

    @app.on_event("startup")
    async def start_analytics_retention() -> None:
        tasks.append(asyncio.create_task(purge_loop(interval)))

    @app.on_event("shutdown")
    async def stop_analytics_retention() -> None:
        while tasks:
            task = tasks.pop()
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
