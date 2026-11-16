"""HTML and text rendering for the weekly email and the confirm note.

The HTML is a component-built, dark-first 600 px email. Inline styles stand
alone; the small <style> block adds the light-mode and phone overrides. There
are no tracking pixels and no third-party logos: calendar actions are text.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from html import escape
from typing import Any
from zoneinfo import ZoneInfo

from .calendar_links import (
    calendar_actions,
    google_subscribe_url,
    item_all_day,
    item_date,
    item_instant,
    item_key,
    item_title,
    page_url,
    subscribe_url,
    week_calendar_url,
)

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

INK = "#f2ede4"
MUTED = "#a9a294"
BG = "#090910"
CARD = "#14121a"
LINE = "#2a2730"
GOLD = "#ff8b77"
GOLD_DEEP = "#f05d49"
# Accent text on the light plates: 5.66:1 on #ffffff, 5.29:1 on #faf7f2.
ACCENT_LIGHT = "#b3412e"
LIGHT_BG = "#faf7f2"
LIGHT_CARD = "#ffffff"
LIGHT_INK = "#14121a"
LIGHT_MUTED = "#5a554d"
LIGHT_LINE = "#e6dfd4"
FONT = (
    "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,"
    "sans-serif"
)
SANS = "font-family:" + FONT + ";"
MAX_WIDTH = 600


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


def _signed(value: float) -> str:
    text = f"{abs(value):.1f}"
    return f"+{text}" if value > 0 else f"−{text}" if value < 0 else text


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


# ---------------------------------------------------------------------------
# HTML components


def _attr(value: Any) -> str:
    return escape(str(value), quote=True)


def _img(
    src: str,
    alt: str,
    width: int,
    height: int,
    display_width: int,
    display_height: int,
    extra: str = "",
    fluid: bool = False,
) -> str:
    size = (
        f"width:100%;max-width:{display_width}px;height:auto;"
        if fluid
        else f"width:{display_width}px;height:{display_height}px;"
    )
    return (
        f'<img src="{_attr(src)}" alt="{_attr(alt)}" width="{width}" '
        f'height="{height}" border="0" '
        f'style="display:block;{size}'
        f'border:0;outline:none;text-decoration:none;{extra}" />'
    )


def _card(content: str, padding: str = "20px", extra: str = "") -> str:
    return (
        f'<table role="presentation" width="100%" cellpadding="0" '
        f'cellspacing="0" border="0" bgcolor="{CARD}" class="sh-card" '
        f'style="width:100%;background-color:{CARD};border:1px solid {LINE};'
        f'border-radius:14px;border-collapse:separate;{extra}">'
        f'<tr><td style="padding:{padding};">{content}</td></tr></table>'
    )


def _heading(text: str, size: int = 18, extra: str = "") -> str:
    return (
        f'<h2 class="sh-ink" style="margin:0 0 8px;{SANS}font-size:{size}px;'
        f'line-height:1.2;font-weight:700;color:{INK};{extra}">{escape(text)}</h2>'
    )


def _body(text: str, extra: str = "") -> str:
    return (
        f'<p class="sh-ink" style="margin:0 0 10px;{SANS}font-size:16px;'
        f'line-height:1.55;color:{INK};{extra}">{text}</p>'
    )


def _muted(text: str, extra: str = "") -> str:
    return (
        f'<p class="sh-muted" style="margin:0 0 8px;{SANS}font-size:14px;'
        f'line-height:1.5;color:{MUTED};{extra}">{text}</p>'
    )


def _chip(text: str) -> str:
    return (
        f'<span class="sh-chip" style="display:inline-block;background:{GOLD};'
        f'color:#14121a;{SANS}font-size:14px;font-weight:700;letter-spacing:1.4px;'
        f'text-transform:uppercase;padding:6px 10px;border-radius:999px;'
        f'white-space:nowrap;">{escape(text)}</span>'
    )


def _button(label: str, href: str, primary: bool = True) -> str:
    bg = GOLD if primary else "transparent"
    fg = "#14121a" if primary else INK
    border = GOLD if primary else LINE
    return (
        '<!--[if mso]>'
        '<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" '
        'xmlns:w="urn:schemas-microsoft-com:office:word" '
        f'href="{_attr(href)}" style="height:64px;v-text-anchor:middle;'
        f'width:320px;" arcsize="50%" strokecolor="{border}" fillcolor="{bg}">'
        '<w:anchorlock/><center style="color:#14121a;font-family:Segoe UI,'
        'Arial,sans-serif;font-size:16px;font-weight:700;">'
        f"{escape(label)}</center></v:roundrect>"
        "<![endif]-->"
        "<!--[if !mso]><!-->"
        f'<a href="{_attr(href)}" style="display:inline-block;min-height:48px;'
        f'line-height:1.2;padding:14px 24px;box-sizing:border-box;'
        f'border-radius:999px;background:{bg};'
        f'color:{fg};border:1px solid {border};{SANS}font-size:16px;'
        f'font-weight:700;text-decoration:none;text-align:center;">{escape(label)}</a>'
        "<!--<![endif]-->"
    )


def _icon_name(item: dict[str, Any]) -> str:
    kind = str(item.get("kind") or "").lower()
    if kind in {"new_moon", "first_quarter", "full_moon", "last_quarter"}:
        return "moon-" + kind.replace("_", "-")
    if "eclipse" in kind:
        return "eclipse"
    if "ingress" in kind:
        return "ingress"
    if "station" in kind:
        return "station"
    if kind == "season":
        return "culture"
    item_id = str(item.get("id") or "")
    if item_id.startswith("finance:"):
        return "finance"
    if item_id.startswith("culture:"):
        return "culture"
    if item_id.startswith("science:"):
        return "eclipse"
    return "calendar"


def _icon(item: dict[str, Any], base_url: str) -> str:
    name = _icon_name(item)
    return _img(
        f"{base_url.rstrip('/')}/email/icons/{name}.png",
        "",
        32,
        32,
        16,
        16,
        "margin-top:3px;",
    )


def _time_chip(item: dict[str, Any]) -> str:
    moment = item_instant(item)
    if moment is None:
        return (
            f'<span class="sh-chip-bg" style="display:inline-block;background:{CARD};'
            f'border:1px solid {LINE};border-radius:999px;padding:4px 8px;'
            f'{SANS}font-size:14px;color:{INK};">All day</span>'
        )
    ist = moment.astimezone(IST)
    utc = moment.astimezone(timezone.utc)
    printed = item_date(item)
    pieces = [
        f'<span class="sh-ink" style="{SANS}font-size:16px;font-weight:700;color:{INK};">'
        f"{ist.strftime('%H:%M')} IST</span>",
        f'<span class="sh-muted" style="{SANS}font-size:14px;color:{MUTED};">'
        f"· {utc.strftime('%H:%M')} UTC</span>",
    ]
    if printed and ist.date() != printed:
        pieces.append(
            f'<span class="sh-muted" style="{SANS}font-size:14px;color:{MUTED};">'
            f"· {ist.strftime('%a')} {ist.day} {ist.strftime('%b')}</span>"
        )
    return (
        f'<span class="sh-chip-bg" style="display:inline-block;background:{CARD};border:1px solid {LINE};'
        f'border-radius:999px;padding:4px 10px;">' + " ".join(pieces) + "</span>"
    )


def _actions(item: dict[str, Any], week: str, base_url: str) -> str:
    links = calendar_actions(item, week, base_url)
    style = (
        f"{SANS}font-size:14px;color:{GOLD};text-decoration:none;"
        "display:inline-block;min-height:44px;line-height:44px;padding:0 4px;"
    )
    return (
        f'<p style="margin:2px 0 0;{SANS}font-size:14px;">'
        f'<a class="sh-accent" href="{_attr(links["google"])}" style="{style}">＋ Google</a>'
        f'<span class="sh-muted" style="color:{MUTED};"> · </span>'
        f'<a class="sh-accent" href="{_attr(links["outlook"])}" style="{style}">Outlook</a>'
        f'<span class="sh-muted" style="color:{MUTED};"> · </span>'
        f'<a class="sh-accent" href="{_attr(links["ics"])}" style="{style}">Apple / .ics</a>'
        "</p>"
    )


def _item_row(
    item: dict[str, Any], week: str, base_url: str, theme: str | None = None
) -> str:
    title = item_title(item)
    href = page_url(item, base_url)
    theme_line = (
        f'<span class="sh-muted" style="{SANS}font-size:14px;color:{MUTED};">'
        f"{escape(theme)}</span>"
        if theme
        else ""
    )
    return (
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
        f'border="0" style="width:100%;border-top:1px solid {LINE};'
        f'border-collapse:collapse;"><tr>'
        f'<td width="30" valign="top" style="width:30px;padding:14px 8px 14px 0;">'
        f"{_icon(item, base_url)}</td>"
        f'<td valign="top" style="padding:12px 0 12px;">'
        f'<p style="margin:0 0 4px;{SANS}font-size:16px;line-height:1.35;">'
        f'<a href="{_attr(href)}" class="sh-ink" style="color:{INK};text-decoration:none;'
        f'font-weight:600;">{escape(title)}</a></p>'
        f"{theme_line}"
        f'<p style="margin:6px 0 0;">{_time_chip(item)}</p>'
        f"{_actions(item, week, base_url)}"
        f'<p style="margin:0;{SANS}font-size:14px;">'
        f'<a href="{_attr(href)}" class="sh-muted" style="color:{MUTED};text-decoration:underline;">'
        "Open the page →</a></p>"
        "</td></tr></table>"
    )


def _sort_key(item: dict[str, Any]) -> tuple[str, str]:
    moment = item_instant(item)
    day = item_date(item)
    return (
        day.isoformat() if day else "9999-12-31",
        moment.strftime("%H:%M:%S") if moment else "00:00:00",
    )


def _timeline(
    items: list[dict[str, Any]],
    week: str,
    base_url: str,
    themes: dict[int, str] | None = None,
) -> str:
    if not items:
        return _muted("No dates in this section.")
    grouped: dict[str, list[tuple[dict[str, Any], str | None]]] = {}
    for item in sorted(items, key=_sort_key):
        day = item_instant(item)
        label = (
            day.astimezone(IST).strftime("%a %d %b").upper()
            if day
            else (
                item_date(item).strftime("%a %d %b").upper()
                if item_date(item)
                else "DATE TO COME"
            )
        )
        theme = (themes or {}).get(id(item))
        grouped.setdefault(label, []).append((item, theme))
    parts: list[str] = []
    for label, rows in grouped.items():
        parts.append(
            f'<p class="sh-accent" style="margin:18px 0 0;{SANS}font-size:14px;font-weight:700;'
            f'letter-spacing:2px;color:{GOLD};">{escape(label)}</p>'
        )
        for item, theme in rows:
            parts.append(_item_row(item, week, base_url, theme))
    return "".join(parts)


def _preheader(roundup: dict[str, Any]) -> str:
    facts: list[str] = []
    regime = roundup.get("regime") or {}
    if regime.get("score") is not None:
        facts.append(
            f"Core Index {_signed(float(regime['score']))} "
            f"{regime.get('label') or ''}".strip()
        )
    sky = (roundup.get("sky_week_items") or roundup.get("sky") or [])
    if sky:
        first = sky[0]
        moment = item_instant(first)
        label = item_title(first)
        facts.append(
            f"{label} {moment.astimezone(IST).strftime('%a %d %b')}"
            if moment
            else label
        )
    next_items = roundup.get("next_two_weeks") or []
    if next_items:
        first = next_items[0]
        moment = item_instant(first)
        label = item_title(first)
        facts.append(
            f"{label} {moment.astimezone(IST).strftime('%a %d %b, %H:%M IST')}"
            if moment
            else label
        )
    text = " · ".join(facts)
    return (
        '<div style="display:none;font-size:1px;line-height:1px;max-height:0;'
        "max-width:0;opacity:0;overflow:hidden;mso-hide:all;"
        f'color:{BG};">{escape(text)}</div>'
    )


def _header(roundup: dict[str, Any], base_url: str) -> str:
    week = str(roundup.get("week") or "")
    page = f"{base_url.rstrip('/')}/this-week/{week}"
    logo = _img(
        f"{base_url.rstrip('/')}/email/logo-dark.png",
        "StrikeHike",
        300,
        64,
        150,
        32,
    )
    return (
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
        f'border="0" style="width:100%;border-collapse:collapse;"><tr>'
        f'<td align="left" valign="middle" style="padding:0 0 18px;">{logo}</td>'
        f'<td align="right" valign="middle" class="sh-stack" style="padding:0 0 18px;">'
        f"{_chip('Weekly · ' + week)}"
        f'<p style="margin:8px 0 0;{SANS}font-size:14px;">'
        f'<a href="{_attr(page)}" class="sh-muted" style="color:{MUTED};text-decoration:underline;">'
        "View in browser</a></p></td>"
        "</tr></table>"
    )


def _hero(roundup: dict[str, Any]) -> str:
    label = week_label(str(roundup.get("week") or ""))
    return (
        f'<p class="sh-accent" style="margin:0 0 6px;{SANS}font-size:14px;font-weight:700;'
        f'letter-spacing:2px;text-transform:uppercase;color:{GOLD};">'
        "This week: macro + sky</p>"
        f'<h1 class="sh-ink" style="margin:0 0 10px;{SANS}font-size:40px;'
        f'line-height:1.05;letter-spacing:-1.2px;font-weight:300;color:{INK};">'
        f"{escape(label)}</h1>"
        f'<div style="height:2px;width:56px;background:{GOLD};margin:0 0 22px;">'
        "</div>"
    )


def _regime_card(roundup: dict[str, Any], base_url: str) -> str:
    regime = roundup.get("regime") or {}
    if regime.get("score") is None:
        return ""
    score = float(regime["score"])
    label = str(regime.get("label") or "")
    change = regime.get("change")
    change_text = (
        f"{_signed(float(change))} from the week before"
        if isinstance(change, (int, float))
        else "The latest weekly reading."
    )
    week = str(roundup.get("week") or "")
    reading = _date(str(regime.get("as_of") or ""))
    spark = ""
    weekly = regime.get("weekly") or []
    if len(weekly) >= 2:
        alt = "Core Index weekly: " + ", ".join(
            f"{float(point['score']):.1f}" for point in weekly
        )
        spark = _img(
            f"{base_url.rstrip('/')}/this-week/{week}/email/regime.png",
            alt,
            1120,
            240,
            560,
            120,
            "margin:14px 0 4px;",
            fluid=True,
        )
    footer = (
        f'<p class="sh-muted" style="margin:8px 0 0;{SANS}font-size:14px;'
        f'color:{MUTED};">Latest reading: {escape(_human_day(reading))} · '
        f'<a class="sh-accent" href="{_attr(base_url.rstrip("/") + "/regime")}" '
        f'style="color:{GOLD};text-decoration:underline;">Open the Regime chart →</a>'
        "</p>"
        if reading
        else ""
    )
    content = (
        f'<p class="sh-accent" style="margin:0 0 8px;{SANS}font-size:14px;font-weight:700;'
        f'letter-spacing:2px;text-transform:uppercase;color:{GOLD};">'
        "Regime · Core Index</p>"
        f'<p style="margin:0;{SANS};font-variant-numeric:tabular-nums;">'
        f'<span class="sh-ink" style="font-size:52px;line-height:1;font-weight:300;'
        f'letter-spacing:-2px;color:{INK};">{_signed(score)}</span> '
        f'<span class="sh-ink" style="display:inline-block;border:1px solid {LINE};'
        f'border-radius:999px;padding:4px 10px;{SANS}font-size:14px;'
        f'color:{INK};">{escape(label)}</span></p>'
        f'<p class="sh-muted" style="margin:8px 0 0;{SANS}font-size:14px;'
        f'color:{MUTED};">{escape(change_text)}</p>'
        f"{spark}{footer}"
    )
    return _card(content)


def _activity_card(roundup: dict[str, Any], base_url: str) -> str:
    activity = roundup.get("activity") or {}
    if not activity:
        return ""
    week = str(roundup.get("week") or "")
    daily = activity.get("daily") or []
    chart = ""
    if daily:
        alt = "Sky activity: " + ", ".join(
            f"{point['score']}" for point in daily
        )
        chart = _img(
            f"{base_url.rstrip('/')}/this-week/{week}/email/activity.png",
            alt,
            1120,
            160,
            560,
            80,
            "margin:10px 0 6px;",
            fluid=True,
        )
    lines = roundup.get("lines") or {}
    closest = activity.get("closest_past") or {}
    closest_html = ""
    if closest:
        closest_path = f"/?d={closest.get('date')}" if closest.get("date") else None
        for_date = _date(
            str(
                closest.get("for_date")
                or activity.get("peak_date")
                or roundup.get("start")
                or ""
            )
        )
        for_label = _human_short(for_date) if for_date else ""
        closest_html = (
            f'<p class="sh-muted" style="margin:0 0 6px;{SANS}font-size:14px;'
            f'color:{MUTED};">Closest past sky to {escape(for_label)}: '
            f'<a href="{_attr(_join(base_url, closest_path))}" class="sh-muted" '
            f'style="color:{MUTED};">{escape(str(closest.get("name") or "past date"))}</a>, '
            f'{escape(_human_date(closest.get("date")))} '
            f'({escape(str(closest.get("similarity_percent") or ""))}% geometry match).'
            "</p>"
        )
    note = str(activity.get("note") or "").strip()
    note_html = (
        f'<p class="sh-muted" style="margin:0;{SANS}font-size:14px;'
        f'color:{MUTED};">{escape(note)}</p>'
        if note
        else ""
    )
    content = (
        f'<p class="sh-accent" style="margin:0 0 4px;{SANS}font-size:14px;font-weight:700;'
        f'letter-spacing:2px;text-transform:uppercase;color:{GOLD};">'
        "Sky activity</p>"
        f"{chart}"
        f"{_body(escape(str(lines.get('activity') or '')), 'margin-bottom:6px;')}"
        f"{closest_html}{note_html}"
    )
    return _card(content)


def _calendar_block(roundup: dict[str, Any], base_url: str) -> str:
    week = str(roundup.get("week") or "")
    icon = _img(
        f"{base_url.rstrip('/')}/email/icons/calendar.png",
        "",
        32,
        32,
        16,
        16,
        "margin-top:3px;",
    )
    content = (
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
        f'border="0"><tr><td width="26" valign="top" style="width:26px;">{icon}</td>'
        f'<td valign="top">'
        f"{_heading('Save the dates', 20)}"
        f"{_muted('This week plus the next two weeks, in one file.')}"
        f'<p style="margin:14px 0 10px;">'
        f"{_button('Add all these dates to your calendar', week_calendar_url(week, base_url))}"
        "</p>"
        f'<p style="margin:0 0 6px;{SANS}font-size:14px;">'
        f'<a class="sh-accent" href="{_attr(subscribe_url(base_url))}" style="color:{GOLD};'
        f'text-decoration:underline;">Subscribe to every StrikeHike date</a></p>'
        f'<p style="margin:0;{SANS}font-size:14px;">'
        f'<a href="{_attr(google_subscribe_url(base_url))}" class="sh-muted" style="color:{MUTED};'
        f'text-decoration:underline;">Google Calendar users: subscribe here</a></p>'
        "</td></tr></table>"
    )
    return _card(content)


def _record_card(roundup: dict[str, Any], base_url: str) -> str:
    record = roundup.get("from_record") or {}
    if not record:
        return ""
    href = _join(base_url, str(record.get("path") or ""))
    content = (
        f'<p class="sh-accent" style="margin:0 0 4px;{SANS}font-size:14px;font-weight:700;'
        f'letter-spacing:2px;text-transform:uppercase;color:{GOLD};">'
        "From the record</p>"
        f'<p style="margin:0 0 4px;{SANS}font-size:17px;font-weight:600;">'
        f'<a href="{_attr(href)}" class="sh-ink" style="color:{INK};text-decoration:none;">'
        f"{escape(str(record.get('title') or 'Claim test'))}</a></p>"
        f"{_muted(escape(str(record.get('result') or '')))}"
        f'<p style="margin:0;{SANS}font-size:14px;">'
        f'<a class="sh-accent" href="{_attr(href)}" style="color:{GOLD};text-decoration:underline;">'
        "See the test →</a></p>"
    )
    return _card(content)


def _footer(
    roundup: dict[str, Any],
    base_url: str,
    unsubscribe_url: str,
    postal_address: str,
    ledger: dict[str, Any] | None,
) -> str:
    logo = _img(
        f"{base_url.rstrip('/')}/email/logo-dark.png",
        "StrikeHike",
        300,
        64,
        120,
        26,
        "margin-bottom:12px;",
    )
    ledger_html = ""
    if ledger:
        ledger_url = f"{base_url.rstrip('/')}/ledger"
        ledger_html = (
            f'<p class="sh-muted" style="margin:0 0 4px;{SANS}font-size:14px;'
            f'color:{MUTED};"><a href="{_attr(ledger_url)}" class="sh-muted" style="color:{MUTED};'
            f'text-decoration:underline;">Ledger #{escape(str(ledger["seq"]))} · '
            f'{escape(str(ledger["hash"])[:12])}</a></p>'
            f'<p class="sh-muted" style="margin:0 0 10px;{SANS}font-size:14px;'
            f'color:{MUTED};">This roundup\'s fingerprint in the public ledger.</p>'
        )
    postal = (
        f'<p class="sh-muted" style="margin:0;{SANS}font-size:14px;color:{MUTED};">'
        f"{escape(postal_address)}</p>"
        if postal_address
        else ""
    )
    return (
        f'<div style="border-top:1px solid {LINE};padding-top:18px;margin-top:24px;">'
        f"{logo}"
        f'<p class="sh-muted" style="margin:0 0 8px;{SANS}font-size:14px;'
        f'color:{MUTED};">{escape(DISCLAIMER)}</p>'
        f'<p class="sh-muted" style="margin:0 0 10px;{SANS}font-size:14px;'
        f'color:{MUTED};">{escape(WHY)}</p>'
        f"{ledger_html}"
        f'<p style="margin:0 0 8px;{SANS}font-size:14px;">'
        f'<a href="{_attr(unsubscribe_url)}" class="sh-muted" style="color:{MUTED};'
        f'text-decoration:underline;">Unsubscribe in one click</a></p>'
        f"{postal}</div>"
    )


def _style_block() -> str:
    return (
        "<style>"
        "@media (prefers-color-scheme: light){"
        f".sh-bg{{background-color:{LIGHT_BG}!important;}}"
        f".sh-card{{background-color:{LIGHT_CARD}!important;border-color:{LIGHT_LINE}!important;}}"
        f".sh-ink{{color:{LIGHT_INK}!important;}}"
        f".sh-muted{{color:{LIGHT_MUTED}!important;}}"
        f".sh-accent{{color:{ACCENT_LIGHT}!important;}}"
        f".sh-chip{{background-color:{GOLD_DEEP}!important;color:{LIGHT_INK}!important;}}"
        f".sh-chip-bg{{background-color:#f1ebe2!important;border-color:{LIGHT_LINE}!important;}}"
        "}"
        "@media (max-width:480px){"
        ".sh-stack{display:block!important;width:100%!important;text-align:left!important;}"
        ".sh-stack p{margin-top:8px!important;}"
        "}"
        "</style>"
    )


def _html_document(inner: str, subject: str) -> str:
    return (
        "<!doctype html>"
        '<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml" '
        'xmlns:w="urn:schemas-microsoft-com:office:word">'
        "<head>"
        '<meta charset="utf-8" />'
        '<meta name="viewport" content="width=device-width, initial-scale=1" />'
        '<meta name="color-scheme" content="dark light" />'
        '<meta name="supported-color-schemes" content="dark light" />'
        f"<title>{escape(subject)}</title>"
        f"{_style_block()}"
        "</head>"
        f'<body style="margin:0;padding:0;background-color:{BG};{SANS}">'
        f"{inner}"
        "</body></html>"
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
            f"Core Index {_signed(float(regime['score']))}"
        )
    else:
        subject = f"StrikeHike weekly · {label}"

    # Plain text keeps the old structure and adds one calendar line per section.
    text_parts = [f"StrikeHike weekly · {label}", ""]
    if regime:
        line = str(lines.get("regime") or "").strip()
        reading = _date(str(regime.get("as_of") or ""))
        text_parts.extend(["REGIME", line or "The latest Regime reading."])
        if reading:
            text_parts.append(f"Latest reading: {_human_day(reading)}.")
        text_parts.append("")
    if themes:
        text_parts.extend(["DATES", str(lines.get("dates") or "").strip()])
        for theme in themes:
            text_parts.append(str(theme.get("name") or "").upper())
            for event in theme.get("events") or []:
                text_parts.append(f"- {_event_line(event)}")
        text_parts.extend(
            ["", f"Add these dates: {week_calendar_url(week, base_url)}", ""]
        )
    if sky:
        text_parts.extend(["SKY", str(lines.get("sky") or "").strip()])
        for event in sky:
            text_parts.append(f"- {_event_line(event)}")
        text_parts.extend(
            ["", f"Add these dates: {week_calendar_url(week, base_url)}", ""]
        )
    if sky_items:
        text_parts.extend(["SKY THIS WEEK", str(lines.get("sky") or "").strip()])
        for event in sky_items:
            text_parts.append(f"- {_sky_event_line(event)}")
        text_parts.extend(
            ["", f"Add these dates: {week_calendar_url(week, base_url)}", ""]
        )
    if activity:
        closest = activity.get("closest_past") or {}
        text_parts.extend(
            ["SKY ACTIVITY", str(lines.get("activity") or "").strip()]
        )
        if closest:
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
        note = str(activity.get("note") or "").strip()
        if note:
            text_parts.append(note)
        text_parts.append("")
    if next_two_weeks:
        text_parts.extend(
            ["NEXT TWO WEEKS", str(lines.get("next") or "").strip()]
        )
        for event in next_two_weeks:
            text_parts.append(f"- {_event_line(event)}")
        text_parts.extend(
            ["", f"Add these dates: {week_calendar_url(week, base_url)}", ""]
        )
    if from_record:
        text_parts.extend(
            [
                "FROM THE RECORD",
                f"{from_record.get('title')} — {from_record.get('result')}",
                _join(base_url, str(from_record.get("path") or "")),
                "",
            ]
        )
    text_parts.extend(
        [
            f"Subscribe to every StrikeHike date: {subscribe_url(base_url)}",
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
    text_parts.append(f"Unsubscribe: {unsubscribe_url}")
    if postal_address:
        text_parts.append(f"Postal address: {postal_address}")
    text_parts.append("")

    # HTML components.
    theme_names: dict[int, str] = {}
    this_week: list[dict[str, Any]] = []
    for theme in themes:
        for event in theme.get("events") or []:
            this_week.append(event)
            theme_names[id(event)] = str(theme.get("name") or "")
    this_week.extend(sky_items or sky)
    cta = _button("Read this week's roundup", page_url)

    html_parts = [
        _preheader(roundup),
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
        f'border="0" bgcolor="{BG}" class="sh-bg" style="width:100%;'
        f'background-color:{BG};margin:0;padding:0;"><tr><td align="center" '
        f'style="padding:24px 12px;">',
        "<!--[if mso]><table role=\"presentation\" width=\"600\" cellpadding=\"0\" "
        "cellspacing=\"0\" border=\"0\"><tr><td><![endif]-->",
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
        f'border="0" style="width:100%;max-width:{MAX_WIDTH}px;margin:0 auto;'
        f'border-collapse:collapse;"><tr><td style="padding:0;">',
        _header(roundup, base_url),
        _hero(roundup),
        _regime_card(roundup, base_url),
        f'<div style="height:20px;line-height:20px;">&nbsp;</div>',
        _card(_heading("This week", 20) + _timeline(this_week, week, base_url, theme_names)),
        f'<div style="height:20px;line-height:20px;">&nbsp;</div>',
        _activity_card(roundup, base_url),
        f'<div style="height:20px;line-height:20px;">&nbsp;</div>' if activity else "",
        _card(
            _heading("Next two weeks", 20)
            + _timeline(next_two_weeks, week, base_url)
        )
        if next_two_weeks
        else "",
        f'<div style="height:20px;line-height:20px;">&nbsp;</div>'
        if next_two_weeks
        else "",
        _calendar_block(roundup, base_url),
        f'<div style="height:20px;line-height:20px;">&nbsp;</div>',
        _record_card(roundup, base_url),
        f'<div style="height:20px;line-height:20px;">&nbsp;</div>' if from_record else "",
        f'<p style="margin:0 0 22px;text-align:center;">{cta}</p>',
        _footer(roundup, base_url, unsubscribe_url, postal_address, ledger),
        "</td></tr></table>",
        "<!--[if mso]></td></tr></table><![endif]-->",
        "</td></tr></table>",
    ]
    return Rendered(
        subject=subject,
        html=_html_document("".join(html_parts), subject),
        text="\n".join(text_parts),
    )


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
        '<p style="font-size:14px;letter-spacing:0.14em;text-transform:uppercase;'
        'color:#a83a27;margin:0 0 6px">StrikeHike weekly</p>'
        '<h1 style="font-size:24px;margin:0 0 10px">Confirm your email</h1>'
        "<p>Open the link and press Confirm subscription. The link expires in 48 hours.</p>"
        f'<p><a href="{escape(confirm_url, quote=True)}" '
        'style="display:inline-block;background:#14121a;color:#fff;padding:10px 16px;'
        'border-radius:999px;text-decoration:none">Confirm subscription</a></p>'
        '<p style="color:#666;font-size:14px">If you did not ask for this, ignore this email.</p>'
        "</div>"
    )
    return Rendered(subject=subject, html=html, text=text)
