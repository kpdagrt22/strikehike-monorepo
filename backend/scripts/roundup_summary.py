"""Render a draft roundup as a GitHub job summary.

Usage: python backend/scripts/roundup_summary.py <roundup.json>
"""

from __future__ import annotations

import json
import sys
from datetime import date, datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND / "src") not in sys.path:
    sys.path.insert(0, str(BACKEND / "src"))

from astro_finance.digest.render import render_roundup  # noqa: E402

IST = ZoneInfo("Asia/Kolkata")


def _date(value: object) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def _day(value: date) -> str:
    return f"{value.strftime('%a')} {value.day} {value.strftime('%b %Y')}"


def _short(value: date) -> str:
    return f"{value.strftime('%a')} {value.day} {value.strftime('%b')}"


def _moment(value: object) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(
            str(value).replace("Z", "+00:00")
        ).astimezone(timezone.utc)
    except ValueError:
        return None


def _event_times(event: dict) -> tuple[str, str]:
    moment = _moment(event.get("start_utc"))
    if moment is not None:
        ist = moment.astimezone(IST)
        ist_label = ist.strftime("%H:%M")
        event_date = _date(event.get("start_date"))
        if event_date and ist.date() != event_date:
            ist_label += f" ({_short(ist.date())})"
        return moment.strftime("%H:%M"), ist_label
    start_time = event.get("start_time")
    if start_time:
        return str(start_time)[:5], "—"
    return "all day", "all day"


def _table(rows: list[tuple[str, str, str, str]]) -> list[str]:
    if not rows:
        return ["_None._", ""]
    lines = [
        "| When | Item | UTC | IST |",
        "| --- | --- | --- | --- |",
    ]
    for when, item, utc, ist in rows:
        lines.append(f"| {when} | {item} | {utc} | {ist} |")
    lines.append("")
    return lines


def summary(roundup: dict) -> str:
    lines = roundup.get("lines") or {}
    out = [f"## Roundup draft {roundup.get('week', '')}", ""]
    for key, label in (
        ("regime", "Regime"),
        ("sky", "Sky"),
        ("activity", "Activity"),
        ("next", "Next"),
    ):
        out.append(f"**{label}:** {lines.get(key) or '—'}")
    out.append("")

    in_week: list[tuple[str, str, str, str]] = []
    for theme in roundup.get("themes") or []:
        for event in theme.get("events") or []:
            when = _date(event.get("start_date"))
            utc, ist = _event_times(event)
            in_week.append(
                (
                    _day(when) if when else str(event.get("start_date") or ""),
                    str(event.get("name") or "Untitled date"),
                    utc,
                    ist,
                )
            )

    next_rows: list[tuple[str, str, str, str]] = []
    for event in roundup.get("next_two_weeks") or []:
        when = _date(event.get("start_date"))
        utc, ist = _event_times(event)
        next_rows.append(
            (
                _day(when) if when else str(event.get("start_date") or ""),
                str(event.get("name") or "Untitled date"),
                utc,
                ist,
            )
        )

    sky_rows: list[tuple[str, str, str, str]] = []
    for item in roundup.get("sky_week_items") or []:
        moment = _moment(item.get("at"))
        if moment is None:
            continue
        ist = moment.astimezone(IST)
        ist_label = ist.strftime("%H:%M")
        if ist.date() != moment.date():
            ist_label += f" ({_short(ist.date())})"
        sky_rows.append(
            (
                _day(moment.date()),
                str(item.get("label") or item.get("body") or "Sky event"),
                moment.strftime("%H:%M"),
                ist_label,
            )
        )

    out.extend(["### Dates this week", ""])
    out.extend(_table(in_week))
    out.extend(["### Next two weeks", ""])
    out.extend(_table(next_rows))
    out.extend(["### Sky this week", ""])
    out.extend(_table(sky_rows))

    activity = roundup.get("activity") or {}
    closest = activity.get("closest_past")
    out.extend(["### Closest past sky", ""])
    if closest:
        for_date = _date(closest.get("for_date")) or _date(
            activity.get("peak_date")
        ) or _date(roundup.get("start"))
        when = _short(for_date) if for_date else str(closest.get("for_date") or "")
        match_date = _date(closest.get("date"))
        out.append(
            f"- **{closest.get('name')}**, "
            f"{_day(match_date) if match_date else closest.get('date')} "
            f"({closest.get('similarity_percent')}% geometry match) · for {when}"
        )
    else:
        out.append("_None qualifies after the hidden categories._")
    out.append("")

    rendered = render_roundup(
        roundup,
        unsubscribe_url="https://strikehike.com/api/digest/unsubscribe?t=PREVIEW",
        postal_address="PREVIEW POSTAL ADDRESS",
        base_url="https://strikehike.com",
    )
    out.extend(["### Email preview", "", f"**Subject:** {rendered.subject}", ""])
    out.extend(["```text", rendered.text, "```", ""])
    return "\n".join(out)


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    args = argv if argv is not None else sys.argv[1:]
    if len(args) != 1:
        print("usage: roundup_summary.py <roundup.json>", file=sys.stderr)
        return 2
    path = Path(args[0])
    try:
        roundup = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"cannot read {path}: {exc}", file=sys.stderr)
        return 1
    print(summary(roundup))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
