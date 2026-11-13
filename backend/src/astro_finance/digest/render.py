"""Plain HTML and text rendering for the weekly email and the confirm note.

No images, no tracking pixels, no click redirects: every link is the real URL.
The wording is descriptive, and the standard "not advice, not a forecast" line
travels with every send.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from html import escape
from typing import Any

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


def _event_line(event: dict[str, Any]) -> str:
    when = _date(str(event.get("start_date") or ""))
    bits = [str(event.get("name") or "Untitled date")]
    if when:
        bits.append(when.strftime("%d %b %Y"))
    if event.get("start_time"):
        bits.append(str(event["start_time"])[:5])
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
    subject = f"StrikeHike weekly · {label}"

    regime = roundup.get("regime") or {}
    lines = roundup.get("lines") or {}
    themes = roundup.get("themes") or []
    sky = roundup.get("sky") or []

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
            text_parts.append(f"Latest reading: week of {reading.strftime('%d %b %Y')}.")
        text_parts.append("")
        html_parts.append(
            '<h2 style="font-size:18px;margin:22px 0 6px">Regime</h2>'
        )
        if line:
            html_parts.append(f"<p style=\"margin:0 0 6px\">{escape(line)}</p>")
        if reading:
            html_parts.append(
                f'<p style="margin:0;color:#555">Latest reading: week of '
                f"{escape(reading.strftime('%d %b %Y'))}.</p>"
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
