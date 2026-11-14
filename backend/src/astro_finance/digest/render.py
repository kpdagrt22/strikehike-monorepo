"""Plain HTML and text rendering for the weekly email and the confirm note.

No images, no tracking pixels, no click redirects: every link is the real URL.
The wording is descriptive, and the standard "not advice, not a forecast" line
travels with every send.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from html import escape
from typing import Any
from zoneinfo import ZoneInfo

IST = ZoneInfo("Asia/Kolkata")

DISCLAIMER = (
    "StrikeHike is descriptive historical research with astronomical context. "
    "It is not investment advice and not a forecast."
)
WHY = "You're getting this because you subscribed on strikehike.com."

MONTHS = (
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
)


@dataclass(frozen=True)
class Rendered:
    subject: str
    html: str
    text: str


def _date(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        return None


def _short(value: date) -> str:
    return f"{value.day} {MONTHS[value.month - 1]}"


def _human_day(value: date) -> str:
    return f"{value.strftime('%a')} {value.day} {value.strftime('%b %Y')}"


def _human_short(value: date) -> str:
    return f"{value.strftime('%a')} {value.day} {value.strftime('%b')}"


def _human_date(value: str | None) -> str:
    parsed = _date(value)
    return _human_day(parsed) if parsed else str(value or "")


def week_label(week: str) -> str:
    try:
        year, number = week.split("-W")
        start = date.fromisocalendar(int(year), int(number), 1)
    except (ValueError, TypeError):
        return week
    end = start + timedelta(days=6)
    if start.year != end.year:
        return f"{_short(start)} {start.year}–{_short(end)} {end.year}"
    if start.month != end.month:
        return f"{_short(start)}–{_short(end)} {end.year}"
    return f"{start.day}–{_short(end)} {end.year}"


def _join(base_url: str, path: str | None) -> str:
    if not path:
        return base_url
    if path.startswith("http://") or path.startswith("https://"):
        return path
    return f"{base_url.rstrip('/')}/{path.lstrip('/')}"


def _time_pair_from_moment(
    moment: datetime, printed_date: date | None = None
) -> str:
    moment = moment.astimezone(timezone.utc)
    ist = moment.astimezone(IST)
    pair = f"{moment.strftime('%H:%M')} UTC · {ist.strftime('%H:%M')} IST"
    if printed_date and ist.date() != printed_date:
        pair += f" ({_human_short(ist.date())})"
    return pair


def _time_pair(
    start_utc: str | None,
    start_time: str | None,
    printed_date: date | None = None,
) -> str | None:
    if start_utc:
        try:
            moment = datetime.fromisoformat(
                str(start_utc).replace("Z", "+00:00")
            ).astimezone(timezone.utc)
        except ValueError:
            moment = None
        if moment is not None:
            return _time_pair_from_moment(moment, printed_date)
    if start_time:
        return str(start_time)[:5]
    return None


def _event_line(event: dict[str, Any]) -> str:
    when = _date(str(event.get("start_date") or ""))
    bits = [str(event.get("name") or "Untitled date")]
    if when:
        bits.append(_human_day(when))
    time = _time_pair(event.get("start_utc"), event.get("start_time"), when)
    if time:
        bits.append(time)
    return " · ".join(bits)


def _html_event(event: dict[str, Any], base_url: str) -> str:
    label = escape(_event_line(event))
    path = event.get("path")
    if not path:
        return f"<li style=\"margin:6px 0\">{label}</li>"
    href = escape(_join(base_url, str(path)), quote=True)
    return (
        f'<li style="margin:6px 0"><a href="{href}" '
        f'style="color:#14121a;text-decoration:underline">{label}</a></li>'
    )


def _sky_event_line(event: dict[str, Any]) -> str:
    label = str(event.get("label") or event.get("body") or "Sky event")
    at = event.get("at")
    if not at:
        return label
    try:
        moment = datetime.fromisoformat(
            str(at).replace("Z", "+00:00")
        ).astimezone(timezone.utc)
    except ValueError:
        return label
    return (
        f"{label} · {_human_day(moment.date())} · "
        f"{_time_pair_from_moment(moment, moment.date())}"
    )


def _html_link(label: str, path: str | None, base_url: str) -> str:
    text = escape(label)
    if not path:
        return text
    href = escape(_join(base_url, str(path)), quote=True)
    return f'<a href="{href}" style="color:#14121a;text-decoration:underline">{text}</a>'


def render_roundup(
    roundup: dict[str, Any],
    *,
    unsubscribe_url: str,
    postal_address: str,
    base_url: str,
    ledger: dict[str, Any] | None = None,
) -> Rendered:
    week = str(roundup.get("week") or "")
    label = week_label(week)
    page_url = f"{base_url.rstrip('/')}/this-week/{week}"
    regime = roundup.get("regime") or {}
    lines = roundup.get("lines") or {}
    themes = roundup.get("themes") or []
    sky = roundup.get("sky") or []
    sky_items = roundup.get("sky_week_items") or []
    activity = roundup.get("activity") or {}
    next_two_weeks = roundup.get("next_two_weeks") or []
    from_record = roundup.get("from_record") or {}
    if roundup.get("schema") == 2 and regime.get("score") is not None:
        subject = (
            f"StrikeHike weekly · {label} · "
            f"Core Index {float(regime['score']):+.1f}"
        )
    else:
        subject = f"StrikeHike weekly · {label}"

    text_parts = [f"StrikeHike weekly · {label}", ""]
    html_parts = [
        '<div style="max-width:640px;margin:0 auto;padding:24px;'
        "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;"
        'color:#14121a;line-height:1.55">',
        f'<p style="font-size:12px;letter-spacing:0.14em;text-transform:uppercase;'
        f'color:#a83a27;margin:0 0 6px">StrikeHike weekly</p>',
        f'<h1 style="font-size:26px;line-height:1.15;margin:0 0 4px">This week: macro + sky</h1>',
        f'<p style="color:#555;margin:0 0 20px">{escape(label)}</p>',
    ]

    if regime:
        line = str(lines.get("regime") or "").strip()
        reading = _date(str(regime.get("as_of") or ""))
        text_parts.extend(["REGIME", line or "The latest Regime reading."])
        if reading:
            text_parts.append(f"Latest reading: {_human_day(reading)}.")
        text_parts.append("")
        html_parts.append(
            '<h2 style="font-size:18px;margin:22px 0 6px">Regime</h2>'
        )
        if line:
            html_parts.append(f"<p style=\"margin:0 0 6px\">{escape(line)}</p>")
        if reading:
            html_parts.append(
                f'<p style="margin:0;color:#555">Latest reading: '
                f"{escape(_human_day(reading))}.</p>"
            )

    if themes:
        text_parts.extend(["DATES", str(lines.get("dates") or "").strip(), ""])
        html_parts.append(
            '<h2 style="font-size:18px;margin:22px 0 6px">Dates</h2>'
        )
        if lines.get("dates"):
            html_parts.append(
                f'<p style="margin:0 0 8px">{escape(str(lines["dates"]))}</p>'
            )
        for theme in themes:
            name = str(theme.get("name") or "")
            text_parts.append(name.upper())
            html_parts.append(
                f'<h3 style="font-size:13px;letter-spacing:0.08em;'
                f'text-transform:uppercase;color:#666;margin:12px 0 4px">'
                f"{escape(name)}</h3><ul style=\"padding-left:18px;margin:0\">"
            )
            for event in theme.get("events") or []:
                text_parts.append(f"- {_event_line(event)}")
                html_parts.append(_html_event(event, base_url))
            html_parts.append("</ul>")
            text_parts.append("")

    if sky:
        text_parts.extend(["SKY", str(lines.get("sky") or "").strip(), ""])
        html_parts.append(
            '<h2 style="font-size:18px;margin:22px 0 6px">Sky</h2>'
        )
        if lines.get("sky"):
            html_parts.append(
                f'<p style="margin:0 0 8px">{escape(str(lines["sky"]))}</p>'
            )
        html_parts.append('<ul style="padding-left:18px;margin:0">')
        for event in sky:
            text_parts.append(f"- {_event_line(event)}")
            html_parts.append(_html_event(event, base_url))
        html_parts.append("</ul>")

    if sky_items:
        text_parts.extend(
            ["SKY THIS WEEK", str(lines.get("sky") or "").strip(), ""]
        )
        html_parts.append(
            '<h2 style="font-size:18px;margin:22px 0 6px">Sky this week</h2>'
        )
        if lines.get("sky"):
            html_parts.append(
                f'<p style="margin:0 0 8px">{escape(str(lines["sky"]))}</p>'
            )
        html_parts.append('<ul style="padding-left:18px;margin:0">')
        for event in sky_items:
            line = _sky_event_line(event)
            text_parts.append(f"- {line}")
            html_parts.append(
                "<li style=\"margin:6px 0\">"
                f"{_html_link(line, event.get('path'), base_url)}</li>"
            )
        html_parts.append("</ul>")
        text_parts.append("")

    if activity:
        closest = activity.get("closest_past") or {}
        text_parts.extend(
            ["SKY ACTIVITY", str(lines.get("activity") or "").strip(), ""]
        )
        html_parts.append(
            '<h2 style="font-size:18px;margin:22px 0 6px">Sky activity</h2>'
        )
        if lines.get("activity"):
            html_parts.append(
                f'<p style="margin:0 0 8px">{escape(str(lines["activity"]))}</p>'
            )
        if closest:
            closest_path = (
                f"/?d={closest.get('date')}" if closest.get("date") else None
            )
            for_date = _date(
                str(
                    closest.get("for_date")
                    or activity.get("peak_date")
                    or roundup.get("start")
                    or ""
                )
            )
            for_label = _human_short(for_date) if for_date else ""
            text_parts.append(
                f"Closest past sky to {for_label}: {closest.get('name')}, "
                f"{_human_date(closest.get('date'))} "
                f"({closest.get('similarity_percent')}% geometry match)."
            )
            html_parts.append(
                '<p style="margin:0 0 8px;color:#555">Closest past sky to '
                f"{escape(for_label)}: "
                f"{_html_link(str(closest.get('name') or 'past date'), closest_path, base_url)}, "
                f"{escape(_human_date(closest.get('date')))} "
                f"({escape(str(closest.get('similarity_percent') or ''))}% geometry match).</p>"
            )
        note = str(activity.get("note") or "").strip()
        if note:
            text_parts.append(note)
            html_parts.append(
                f'<p style="margin:0 0 8px;color:#666;font-size:13px">{escape(note)}</p>'
            )
        text_parts.append("")

    if next_two_weeks:
        text_parts.extend(
            ["NEXT TWO WEEKS", str(lines.get("next") or "").strip(), ""]
        )
        html_parts.append(
            '<h2 style="font-size:18px;margin:22px 0 6px">Next two weeks</h2>'
        )
        if lines.get("next"):
            html_parts.append(
                f'<p style="margin:0 0 8px">{escape(str(lines["next"]))}</p>'
            )
        html_parts.append('<ul style="padding-left:18px;margin:0">')
        for event in next_two_weeks:
            text_parts.append(f"- {_event_line(event)}")
            html_parts.append(_html_event(event, base_url))
        html_parts.append("</ul>")
        text_parts.append("")

    if from_record:
        text_parts.extend(
            [
                "FROM THE RECORD",
                f"{from_record.get('title')} — {from_record.get('result')}",
                _join(base_url, str(from_record.get("path") or "")),
                "",
            ]
        )
        html_parts.append(
            '<h2 style="font-size:18px;margin:22px 0 6px">From the record</h2>'
        )
        html_parts.append(
            "<p style=\"margin:0 0 6px\">"
            f"{_html_link(str(from_record.get('title') or 'Claim test'), from_record.get('path'), base_url)}</p>"
        )
        html_parts.append(
            f'<p style="margin:0;color:#555">{escape(str(from_record.get("result") or ""))}</p>'
        )

    text_parts.extend(
        [
            "",
            f"Read this week's roundup: {page_url}",
            "",
            DISCLAIMER,
            "",
            WHY,
        ]
    )
    if ledger:
        text_parts.append(
            f"Ledger #{ledger['seq']} · {str(ledger['hash'])[:12]} — "
            "strikehike.com/ledger"
        )
    text_parts.extend(
        [
            f"Unsubscribe: {unsubscribe_url}",
        ]
    )
    if postal_address:
        text_parts.append(f"Postal address: {postal_address}")
    text_parts.append("")

    html_parts.extend(
        [
            f'<p style="margin:24px 0 6px"><a href="{escape(page_url, quote=True)}" '
            f'style="color:#14121a;font-weight:600">Read this week\'s roundup</a></p>',
            '<hr style="border:none;border-top:1px solid #ddd;margin:22px 0">',
            f'<p style="color:#666;font-size:13px;margin:0 0 8px">{escape(DISCLAIMER)}</p>',
            f'<p style="color:#666;font-size:13px;margin:0 0 8px">{escape(WHY)}</p>',
        ]
    )
    if ledger:
        ledger_url = f"{base_url.rstrip('/')}/ledger"
        html_parts.append(
            f'<p style="color:#666;font-size:13px;margin:0 0 8px">'
            f'<a href="{escape(ledger_url, quote=True)}" style="color:#666">'
            f"Ledger #{ledger['seq']} · {escape(str(ledger['hash'])[:12])} — "
            "strikehike.com/ledger</a></p>"
        )
    html_parts.append(
        f'<p style="color:#666;font-size:13px;margin:0 0 8px">'
        f'<a href="{escape(unsubscribe_url, quote=True)}" style="color:#666">'
        f"Unsubscribe in one click</a></p>"
    )
    if postal_address:
        html_parts.append(
            f'<p style="color:#666;font-size:13px;margin:0">{escape(postal_address)}</p>'
        )
    html_parts.append("</div>")

    return Rendered(subject=subject, html="".join(html_parts), text="\n".join(text_parts))


def render_confirmation(confirm_url: str, *, base_url: str) -> Rendered:
    del base_url  # kept for a stable call shape
    subject = "Confirm your StrikeHike weekly email"
    text = (
        "Confirm your StrikeHike weekly email\n\n"
        f"Open this link and press Confirm subscription: {confirm_url}\n\n"
        "The link expires in 48 hours. If you did not ask for this, ignore this email."
    )
    html = (
        '<div style="max-width:560px;margin:0 auto;padding:24px;'
        "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;"
        'color:#14121a;line-height:1.55">'
        '<p style="font-size:12px;letter-spacing:0.14em;text-transform:uppercase;'
        'color:#a83a27;margin:0 0 6px">StrikeHike weekly</p>'
        '<h1 style="font-size:24px;margin:0 0 10px">Confirm your email</h1>'
        "<p>Open the link and press Confirm subscription. The link expires in 48 hours.</p>"
        f'<p><a href="{escape(confirm_url, quote=True)}" '
        'style="display:inline-block;background:#14121a;color:#fff;padding:10px 16px;'
        'border-radius:999px;text-decoration:none">Confirm subscription</a></p>'
        '<p style="color:#666;font-size:13px">If you did not ask for this, ignore this email.</p>'
        "</div>"
    )
    return Rendered(subject=subject, html=html, text=text)
