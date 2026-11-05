from __future__ import annotations

import gzip
import json
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from astro_finance.analytics.serverlogs import aggregate

IST = ZoneInfo("Asia/Kolkata")


def stamp(day: int, hour: int = 12) -> float:
    return datetime(2026, 11, day, hour, tzinfo=IST).timestamp()


def line(
    path: str,
    *,
    status: int = 200,
    ts: float,
    agent: str = "Mozilla/5.0 Chrome/124",
    referer: str | None = None,
    remote: str = "203.0.113.0",
    method: str = "GET",
) -> dict:
    headers = {"User-Agent": [agent]}
    if referer:
        headers["Referer"] = [referer]
    return {
        "ts": ts,
        "status": status,
        "request": {
            "method": method,
            "uri": path,
            "remote_ip": remote,
            "headers": headers,
        },
    }


def write_lines(path: Path, rows: list[dict]) -> None:
    path.write_text(
        "".join(json.dumps(row, separators=(",", ":")) + "\n" for row in rows),
        encoding="utf-8",
    )


def test_aggregate_reads_active_and_rolled_logs_and_keeps_no_identifiers(tmp_path):
    logs = tmp_path / "logs"
    logs.mkdir()
    write_lines(
        logs / "strikehike.access.log",
        [
            line("/", ts=stamp(3), referer="https://news.ycombinator.com/"),
            line("/regime", ts=stamp(3), agent="Googlebot/2.1"),
            line("/missing", ts=stamp(3), status=404),
            line("/calendar/science.ics", ts=stamp(3)),
            line("/_next/static/app.js", ts=stamp(3)),
            line("/", ts=stamp(20)),
        ],
    )
    with gzip.open(logs / "strikehike.access-2026-11-03T00-00-00-size.log.gz", "wt", encoding="utf-8") as handle:
        for row in [
            line("/patterns", ts=stamp(4), remote="192.0.2.0"),
            line("/calendar/finance.ics", ts=stamp(4), remote="198.51.100.0"),
            line("/old", ts=stamp(4), status=301),
            line("/boom", ts=stamp(4), status=500),
        ]:
            handle.write(json.dumps(row, separators=(",", ":")) + "\n")

    result = aggregate(logs, "2026-W45")

    assert result["requests"] == 9
    assert result["status"] == {"2xx": 6, "3xx": 1, "4xx": 1, "5xx": 1}
    assert result["page_requests"]["/"] == 1
    assert result["page_requests"]["/regime"] == 1
    assert result["page_requests"]["/patterns"] == 1
    assert result["page_requests"]["other"] == 3
    assert result["referrer_classes"]["community"] == 1
    assert result["referrer_classes"]["direct"] == 5
    assert result["bot_requests"] == 1
    assert result["human_requests"] == 8
    assert result["bot_share"] == 11.1
    assert result["calendar_feeds"]["science"] == {
        "fetches": 1,
        "subscribers_approx": 1,
    }
    assert result["calendar_feeds"]["finance"] == {
        "fetches": 1,
        "subscribers_approx": 1,
    }
    assert result["not_found"] == 1

    text = json.dumps(result)
    for forbidden in (
        "203.0.113.0",
        "198.51.100.0",
        "192.0.2.0",
        "Googlebot",
        "news.ycombinator.com",
        "Chrome",
    ):
        assert forbidden not in text
