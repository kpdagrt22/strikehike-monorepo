"""Aggregates-only weekly export for the private growth report."""

from __future__ import annotations

import json
import threading
import time
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path
from typing import Any, Callable

from .routes import PAGE_TEMPLATES, page_template
from .serverlogs import aggregate as aggregate_server_logs
from .serverlogs import people_cell, week_bounds
from .store import AnalyticsStore

MEANINGFUL = frozenset(
    {
        "date_travelled",
        "asset_compared",
        "case_opened",
        "upcoming_opened",
        "theme_selected",
        "event_source_clicked",
        "method_opened",
        "calendar_subscribed",
        "share_clicked",
        "link_shared",
        "theme_followed",
        "change_note",
        "experiment_exposed",
    }
)
NON_MEANINGFUL_METHODS = frozenset({"deep_link", "page"})
CACHE_SECONDS = 600

_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_cache_lock = threading.Lock()
_clock = time.monotonic


def _rate(numerator: int, denominator: int) -> dict[str, Any]:
    if denominator < 5:
        return {"value": None, "reason": "insufficient data (n<5)"}
    return {"value": round(100 * numerator / denominator, 1), "n": denominator}


def _props(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if not isinstance(value, str):
        return {}
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _meaningful(name: str, props: dict[str, Any]) -> bool:
    return name in MEANINGFUL and str(props.get("method") or "") not in NON_MEANINGFUL_METHODS


def _week_events(store: AnalyticsStore, week: str) -> list[dict[str, Any]]:
    rows = store.connection.execute(
        "SELECT id, received_at, session_id, anon_id, name, path, props, "
        "day_ist, ephemeral, device_class, geo_bucket "
        "FROM events WHERE week_ist=? ORDER BY received_at, id",
        (week,),
    ).fetchall()
    return [dict(row) for row in rows]


def _new_events(store: AnalyticsStore, start: date, end: date) -> list[dict[str, Any]]:
    rows = store.connection.execute(
        """
        SELECT e.id, e.received_at, e.session_id, e.anon_id, e.name, e.path,
               e.props, e.day_ist, e.ephemeral
        FROM events e
        JOIN (
          SELECT anon_id FROM events GROUP BY anon_id
          HAVING MIN(day_ist) BETWEEN ? AND ? AND MAX(ephemeral)=0
        ) new_ids ON new_ids.anon_id=e.anon_id
        ORDER BY e.anon_id, e.received_at, e.id
        """,
        (start.isoformat(), end.isoformat()),
    ).fetchall()
    return [dict(row) for row in rows]


def _cohort_activity(
    store: AnalyticsStore, start: date, end: date
) -> list[dict[str, Any]]:
    rows = store.connection.execute(
        """
        WITH cohort AS (
          SELECT anon_id, MIN(day_ist) AS first_day
          FROM events GROUP BY anon_id
          HAVING MIN(day_ist) BETWEEN ? AND ? AND MAX(ephemeral)=0
        )
        SELECT c.anon_id, c.first_day, e.day_ist
        FROM cohort c JOIN events e ON e.anon_id=c.anon_id
        WHERE e.day_ist BETWEEN c.first_day AND date(c.first_day, '+7 day')
        ORDER BY c.anon_id, e.day_ist
        """,
        (start.isoformat(), end.isoformat()),
    ).fetchall()
    return [dict(row) for row in rows]


def _retention(
    store: AnalyticsStore, week_start: date
) -> dict[str, dict[str, Any]]:
    cohort_end = week_start - timedelta(days=1)
    cohort_start = cohort_end - timedelta(days=6)
    rows = _cohort_activity(store, cohort_start, cohort_end)
    first_days: dict[str, date] = {}
    days: dict[str, set[date]] = defaultdict(set)
    for row in rows:
        first = date.fromisoformat(str(row["first_day"]))
        first_days.setdefault(row["anon_id"], first)
        days[row["anon_id"]].add(date.fromisoformat(str(row["day_ist"])))

    d1 = 0
    d7 = 0
    for aid, first in first_days.items():
        active = days[aid]
        if first + timedelta(days=1) in active:
            d1 += 1
        if any(first + timedelta(days=offset) in active for offset in range(2, 8)):
            d7 += 1
    n = len(first_days)
    return {"d1": _rate(d1, n), "d7": _rate(d7, n)}


def _server(log_dir: str | Path, week: str) -> dict[str, Any]:
    return aggregate_server_logs(log_dir, week)


def _experiment_split(events: list[dict[str, Any]]) -> dict[str, Any]:
    """Engaged sessions per variant, for each experiment that reported exposures.

    A session is engaged when it has at least one meaningful event beyond seeing
    the experiment itself: the exposure is meaningful, but counting it as the
    engagement would make the measure circular. A session is counted under the
    variant it reported in ``experiment_exposed``. An experiment only appears
    when an exposure was actually sent, so an inactive experiment that reports
    nothing is absent rather than shown as a zero.
    """
    exposed: dict[str, dict[str, str]] = defaultdict(dict)
    engaged: set[str] = set()
    for row in events:
        props = _props(row["props"])
        if row["name"] == "experiment_exposed":
            exp = props.get("exp")
            variant = props.get("variant")
            if isinstance(exp, str) and exp and isinstance(variant, str) and variant:
                exposed[exp][row["session_id"]] = variant
            continue
        if _meaningful(row["name"], props):
            engaged.add(row["session_id"])
    split: dict[str, Any] = {}
    for exp in sorted(exposed):
        counts: dict[str, int] = defaultdict(int)
        for session, variant in exposed[exp].items():
            if session in engaged:
                counts[variant] += 1
        split[exp] = {
            "assigned_sessions": len(exposed[exp]),
            "engaged_sessions": sum(counts.values()),
            "variants": {variant: counts[variant] for variant in sorted(counts)},
        }
    return split


EXPORT_VERSION = 2
DEVICES = ("phone", "tablet", "desktop")
REGIONS = ("IN", "UK", "EU", "US", "other", "unknown")
UPCOMING_PAGES = frozenset({"/upcoming", "/upcoming/[theme]"})
REFERENCE_PAGES = frozenset({"/recessions/[id]", "/declines/[id]", "/tested/[claim]"})


def _engaging(name: str, props: dict[str, Any]) -> bool:
    """A real action: meaningful, but not merely being shown an experiment."""
    return name != "experiment_exposed" and _meaningful(name, props)


def _viewed(*pages: str) -> Callable[[str, str, dict[str, Any]], bool]:
    wanted = frozenset(pages)
    return lambda name, path, props: name == "page_viewed" and path in wanted


# Each funnel is an ordered list of (step, matcher). A session reaches a step
# when it has a matching event after reaching the previous one.
FUNNELS: dict[str, list[tuple[str, Callable[[str, str, dict[str, Any]], bool]]]] = {
    "home_to_action": [
        ("viewed home", _viewed("/")),
        ("took an action", lambda name, path, props: _engaging(name, props)),
    ],
    "upcoming_to_source": [
        ("viewed Upcoming", _viewed(*UPCOMING_PAGES)),
        ("opened an event page", _viewed("/events/[id]")),
        (
            "opened the source or a calendar",
            lambda name, path, props: name
            in {"event_source_clicked", "calendar_subscribed"},
        ),
    ],
    "reference_to_share": [
        ("viewed a reference page", _viewed(*REFERENCE_PAGES)),
        ("shared it", lambda name, path, props: name == "share_clicked"),
    ],
}


def _sessions(events: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Per session: who, its device and region (from its first event), and
    whether it took a real action."""
    sessions: dict[str, dict[str, Any]] = {}
    for row in events:
        props = _props(row["props"])
        session = sessions.setdefault(
            row["session_id"],
            {
                "anon_id": row["anon_id"],
                "device": row.get("device_class") or "unknown",
                "region": row.get("geo_bucket") or "unknown",
                "engaged": False,
                "rows": [],
            },
        )
        session["rows"].append((row["name"], row["path"], props))
        if _engaging(row["name"], props):
            session["engaged"] = True
    return sessions


def _breakdown(
    sessions: dict[str, dict[str, Any]], key: str, values: tuple[str, ...]
) -> dict[str, Any]:
    groups: dict[str, dict[str, Any]] = {
        value: {"ids": set(), "sessions": 0, "engaged": 0} for value in values
    }
    for session in sessions.values():
        bucket = session[key] if session[key] in groups else values[-1]
        group = groups[bucket]
        group["ids"].add(session["anon_id"])
        group["sessions"] += 1
        group["engaged"] += int(session["engaged"])
    return {
        value: {
            "visitors": people_cell(len(group["ids"])),
            "sessions": people_cell(group["sessions"]),
            "engaged_sessions": people_cell(group["engaged"]),
            "engagement_rate": _rate(group["engaged"], group["sessions"]),
        }
        for value, group in groups.items()
    }


def _funnels(sessions: dict[str, dict[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for funnel, steps in FUNNELS.items():
        reached = [0] * len(steps)
        for session in sessions.values():
            step = 0
            for name, path, props in session["rows"]:
                if step < len(steps) and steps[step][1](name, path, props):
                    reached[step] += 1
                    step += 1
        result[funnel] = [
            {
                "step": label,
                "sessions": people_cell(reached[index]),
                "from_previous": (
                    None if index == 0 else _rate(reached[index], reached[index - 1])
                ),
            }
            for index, (label, _match) in enumerate(steps)
        ]
    return result


def build_weekly_export(
    store: AnalyticsStore, week: str, log_dir: str | Path = "/app/data/caddy-logs"
) -> dict[str, Any]:
    """Build aggregates for one complete IST week.

    Every people-count cell below five is suppressed. Event, request and view
    counts are not people counts and remain available for the private report.
    """
    start_dt, end_dt = week_bounds(week)
    start = start_dt.date()
    end = end_dt.date() - timedelta(days=1)

    with store.lock:
        events = _week_events(store, week)
        new_event_rows = _new_events(store, start, end)
        sessions = int(
            store.connection.execute(
                """
                SELECT COUNT(*) FROM (
                  SELECT session_id FROM events GROUP BY session_id
                  HAVING MIN(received_at) >= ? AND MIN(received_at) < ?
                )
                """,
                (int(start_dt.timestamp() * 1000), int(end_dt.timestamp() * 1000)),
            ).fetchone()[0]
        )

        new_groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for row in new_event_rows:
            new_groups[row["anon_id"]].append(row)
        new_ids = set(new_groups)
        activated = 0
        for rows in new_groups.values():
            first = min(rows, key=lambda row: (row["received_at"], row["id"]))
            if any(
                row["session_id"] == first["session_id"]
                and _meaningful(row["name"], _props(row["props"]))
                for row in rows
            ):
                activated += 1

        visitors = len({row["anon_id"] for row in events})
        returning = visitors - len(new_ids)

        page_views: dict[str, dict[str, Any]] = {
            template: {"views": 0, "ids": set()} for template in PAGE_TEMPLATES
        }
        event_counts: dict[str, dict[str, Any]] = {}
        meaningful_we: set[str] = set()
        prior = store.connection.execute(
            "SELECT 1 FROM events WHERE week_ist < ? LIMIT 1", (week,)
        ).fetchone()
        prior_ids = (
            {
                row["anon_id"]
                for row in store.connection.execute(
                    "SELECT DISTINCT anon_id FROM events WHERE week_ist < ?", (week,)
                )
            }
            if prior
            else set()
        )

        for row in events:
            props = _props(row["props"])
            template = page_template(row["path"])
            if row["name"] == "page_viewed":
                page_views[template]["views"] += 1
                page_views[template]["ids"].add(row["anon_id"])
            event_entry = event_counts.setdefault(
                row["name"], {"count": 0, "ids": set()}
            )
            event_entry["count"] += 1
            event_entry["ids"].add(row["anon_id"])
            if _meaningful(row["name"], props):
                meaningful_we.add(row["anon_id"])

        wre = {
            row["anon_id"]
            for row in events
            if row["ephemeral"] == 0
            and _meaningful(row["name"], _props(row["props"]))
            and row["anon_id"] in prior_ids
        }

        retention = _retention(store, start)
        experiments = _experiment_split(events)
        week_sessions = _sessions(events)

        stats = store.connection.execute(
            "SELECT * FROM ingest_stats WHERE day_ist BETWEEN ? AND ?",
            (start.isoformat(), end.isoformat()),
        ).fetchall()
        sums = {
            key: sum(int(row[key] or 0) for row in stats)
            for key in (
                "accepted",
                "dropped_bot",
                "dropped_rate",
                "dropped_schema",
                "dropped_origin",
                "dropped_size",
                "stripped_props",
                "global_cap_hit",
            )
        }
        bot_denominator = sums["accepted"] + sums["dropped_bot"]

        feedback = [
            {
                "day": row["day_ist"],
                "page": page_template(row["path"]),
                "message": row["message"],
            }
            for row in store.connection.execute(
                "SELECT day_ist, path, message FROM feedback "
                "WHERE day_ist BETWEEN ? AND ? ORDER BY received_at, id",
                (start.isoformat(), end.isoformat()),
            )
        ]

    page_export = {
        template: {
            "views": values["views"],
            "visitors": people_cell(len(values["ids"])),
        }
        for template, values in page_views.items()
    }
    event_export = {
        name: {
            "count": values["count"],
            "visitors": people_cell(len(values["ids"])),
        }
        for name, values in sorted(event_counts.items())
    }
    wre_cell = (
        people_cell(len(wre))
        if prior
        else {"value": None, "reason": "insufficient data (no earlier week)"}
    )

    engaged_sessions = sum(int(s["engaged"]) for s in week_sessions.values())
    return {
        "export_version": EXPORT_VERSION,
        "week": week,
        "period": {"start": start.isoformat(), "end": end.isoformat()},
        "product": {
            "visitors": people_cell(visitors),
            "new": people_cell(len(new_ids)),
            "returning": people_cell(returning),
            "sessions": sessions,
            "page_views": page_export,
            "events": event_export,
            "activation_rate": _rate(activated, len(new_ids)),
            "weekly_explorers": people_cell(len(meaningful_we)),
            "weekly_returning_explorers": wre_cell,
            "retention": retention,
            "experiments": experiments,
            # v2: engagement, device, region and funnels. Session counts are
            # treated as people counts and suppressed below five.
            "engagement": {
                "sessions": people_cell(len(week_sessions)),
                "engaged_sessions": people_cell(engaged_sessions),
                "engagement_rate": _rate(engaged_sessions, len(week_sessions)),
            },
            "by_device": _breakdown(week_sessions, "device", (*DEVICES, "unknown")),
            "by_region": _breakdown(week_sessions, "region", REGIONS),
            "funnels": _funnels(week_sessions),
        },
        "server": _server(log_dir, week),
        "feedback": feedback,
        "data_quality": {
            "accepted": sums["accepted"],
            "drops": {
                "bot": sums["dropped_bot"],
                "rate": sums["dropped_rate"],
                "schema": sums["dropped_schema"],
                "origin": sums["dropped_origin"],
                "size": sums["dropped_size"],
            },
            "stripped_props": sums["stripped_props"],
            "global_cap_hit": sums["global_cap_hit"],
            "bot_share": (
                round(100 * sums["dropped_bot"] / bot_denominator, 1)
                if bot_denominator
                else 0.0
            ),
            "suspect_bot_count": sums["dropped_bot"],
        },
    }


def cached_weekly_export(
    store: AnalyticsStore, week: str, log_dir: str | Path = "/app/data/caddy-logs"
) -> dict[str, Any]:
    """build_weekly_export, kept in memory for 10 minutes per week key.

    Repeated calls do not rescan the logs. Data that arrives inside the window
    appears once the entry expires. Invalid weeks raise and are not cached.
    """
    now = _clock()
    with _cache_lock:
        hit = _cache.get(week)
        if hit is not None and now - hit[0] < CACHE_SECONDS:
            return hit[1]
    payload = build_weekly_export(store, week, log_dir)
    with _cache_lock:
        for key in [k for k, (at, _) in _cache.items() if now - at >= CACHE_SECONDS]:
            del _cache[key]
        _cache[week] = (now, payload)
    return payload


def clear_weekly_cache() -> None:
    with _cache_lock:
        _cache.clear()
