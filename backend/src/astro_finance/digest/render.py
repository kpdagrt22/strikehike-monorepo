"""HTML and text rendering for the weekly email and the confirm note.

The weekly email wears strikehike.com's own theme. It is light-first, like the
site for most visitors: the cream sky, pearl cards, ink text, and the weekly
roundup's gold as the one accent. Every colour is inline, so a client that
drops the <style> blocks (Gmail apps on non-Gmail accounts) still shows the
whole design. Two <style> blocks only enhance it: one for phones, and one that
gives Apple Mail, iOS Mail, Outlook for Mac and Outlook.com the site's night
palette in dark mode. Layout is tables only; no flexbox, grid or SVG. Images
are hosted PNGs at 2x with width, height and alt, and every fact in them is
also in live text, so the email reads in full with images off. There are no
tracking pixels and no third-party logos: calendar actions are text.
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
    item_date,
    item_instant,
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

# ---------------------------------------------------------------------------
# The palette: strikehike.com's tokens (frontend/src/app/globals.css), with
# the alpha steps flattened onto their plates, since an email needs solid
# colours. Every text colour keeps 4.5:1 on every plate it sits on, in both
# modes (tests/test_digest.py checks each pair).

LIGHT = {
    "page": "#f1ebe2",  # --sh-engine-sky, the 62% stop
    "card": "#fcfaf7",  # --sh-surface-card over the sky
    "soft": "#f6eee0",  # --sh-weekly-soft over the card: the calendar card, the chip
    "line": "#e5dfd6",  # --sh-line-1
    "line2": "#d3ccc1",  # --sh-line-2: pills, the chart axis
    "softline": "#e4d2b4",  # --sh-weekly-line
    "text1": "#2a272f",  # --sh-text-1
    "text2": "#56535a",  # --sh-text-2
    "text3": "#69666b",  # --sh-text-3, one step darker so it holds 4.5:1 on the sky
    "accent": "#855404",  # --sh-weekly: the roundup's gold, as text
    "dot": "#c98a1e",  # --sh-weekly-dot (a bullet glyph, not text)
    "signal": "#b3412e",  # --sh-signal-ink, one step darker for 4.5:1 on the sky
    "wfill": "#1d160c",  # --sh-weekly-fill: the calendar button
    "won": "#f6dfae",  # --sh-weekly-on-fill
    "ifill": "#14121a",  # --sh-ink: the main button, as on the home page
    "ion": "#faf7f2",
    "bar": "#d3ccc1",  # earlier Core Index readings
    "barstrong": "#2a272f",  # the latest reading
    "act": "#f1bfb4",  # sky activity, a soft signal
    "actpeak": "#e0533e",  # the busiest day, --sh-signal
}

DARK = {
    "page": "#0b0b12",  # the night sky (--sh-surface-overlay, opaque)
    "card": "#15151d",
    "soft": "#1e1a15",  # --sh-weekly-soft over the night card
    "line": "#27262f",  # --sh-line-1
    "line2": "#383742",  # --sh-line-2
    "softline": "#4a3e2b",  # --sh-weekly-line
    "text1": "#ece7df",  # --sh-text-1
    "text2": "#b4b0aa",  # --sh-text-2
    "text3": "#9c9994",  # --sh-text-3
    "accent": "#f0c674",  # --sh-weekly
    "dot": "#f5b942",  # --sh-weekly-dot
    "signal": "#ff8b77",  # --sh-signal-ink
    "wfill": "#f0c674",  # --sh-weekly-fill
    "won": "#1d160c",  # --sh-weekly-on-fill
    "ifill": "#f2ede4",  # --sh-pearl
    "ion": "#14121a",
    "bar": "#3b3a45",
    "barstrong": "#ece7df",
    "act": "#6a3730",
    "actpeak": "#ff8b77",
}

# The class each inline text colour carries, so the dark rules can reach it.
TEXT_CLASSES = {
    "text1": "t1",
    "text2": "t2",
    "text3": "t3",
    "accent": "ta",
    "signal": "ts",
    "won": "bwt",
    "ion": "bit",
}

L = LIGHT
FONT = (
    "'Onest',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,"
    "Arial,sans-serif"
)
MAX_WIDTH = 600
# Gmail clips a message at 102 KB, which would hide the footer and its
# unsubscribe link. Past this budget, items fall back to one .ics action.
HTML_BUDGET = 80 * 1024
ASSETS = "email/v3"
FONT_FILE = "onest-latin.woff2"


@dataclass(frozen=True)
class Rendered:
    subject: str
    html: str
    text: str


# ---------------------------------------------------------------------------
# Dates and numbers


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


def _sort_key(item: dict[str, Any]) -> tuple[str, str]:
    moment = item_instant(item)
    day = moment.astimezone(IST).date() if moment else item_date(item)
    return (
        day.isoformat() if day else "9999-12-31",
        moment.strftime("%Y%m%dT%H%M%S") if moment else "",
    )


# ---------------------------------------------------------------------------
# HTML primitives. Inline styles stand alone; classes only let the dark rules
# and the phone rules reach an element.


def _attr(value: Any) -> str:
    return escape(str(value), quote=True)


def _asset(base_url: str, name: str) -> str:
    return f"{base_url.rstrip('/')}/{ASSETS}/{name}"


def _text_style(role: str) -> tuple[str, str]:
    """The class and the inline colour for a text role."""

    return TEXT_CLASSES[role], f"color:{L[role]};"


def _p(
    html: str,
    role: str = "text1",
    *,
    size: int = 16,
    line: int = 24,
    weight: int = 400,
    margin: str = "0",
    extra: str = "",
    cls: str = "",
) -> str:
    klass, colour = _text_style(role)
    classes = f"{klass} {cls}".strip()
    bold = f"font-weight:{weight};" if weight != 400 else ""
    return (
        f'<p class="{classes}" style="margin:{margin};font-size:{size}px;'
        f'line-height:{line}px;{bold}{colour}{extra}">{html}</p>'
    )


def _span(html: str, role: str, extra: str = "") -> str:
    klass, colour = _text_style(role)
    return f'<span class="{klass}" style="{colour}{extra}">{html}</span>'


def _link(
    label: str, href: str, role: str = "text2", *, underline: bool = True, extra: str = ""
) -> str:
    klass, colour = _text_style(role)
    decoration = "underline" if underline else "none"
    return (
        f'<a href="{_attr(href)}" class="{klass}" style="{colour}'
        f'text-decoration:{decoration};{extra}">{escape(label)}</a>'
    )


def _img(
    src: str,
    alt: str,
    width: int,
    height: int,
    extra: str = "",
) -> str:
    return (
        f'<img src="{_attr(src)}" alt="{_attr(alt)}" width="{width}" '
        f'height="{height}" border="0" style="display:block;width:{width}px;'
        f'height:{height}px;border:0;{extra}" />'
    )


def _icon(base_url: str, name: str, size: int = 32) -> str:
    return _img(_asset(base_url, f"icons/{name}.png"), "", size, size)


def _table(content: str, extra: str = "", attrs: str = "") -> str:
    return (
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
        f'border="0" {attrs}style="width:100%;border-collapse:collapse;{extra}">'
        f"{content}</table>"
    )


def _label(text: str, role: str = "text3", margin: str = "0") -> str:
    """The site's micro label: small, tracked, upper case by CSS."""

    return _p(
        escape(text),
        role,
        size=13,
        line=18,
        weight=600,
        margin=margin,
        extra="letter-spacing:1.6px;text-transform:uppercase;",
    )


def _card(content: str, *, soft: bool = False, padding: str = "24px") -> str:
    bg, border, cls = (
        (L["soft"], L["softline"], "sw") if soft else (L["card"], L["line"], "sc")
    )
    return (
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
        f'border="0" bgcolor="{bg}" class="{cls}" style="width:100%;'
        f"background-color:{bg};border:1px solid {border};border-radius:16px;"
        f'border-collapse:separate;"><tr><td class="cp" style="padding:{padding};">'
        f"{content}</td></tr></table>"
    )


def _gap(height: int = 16) -> str:
    return (
        f'<tr><td height="{height}" style="height:{height}px;font-size:0;'
        f'line-height:0;">&nbsp;</td></tr>'
    )


def _row(content: str, padding: str = "0") -> str:
    return f'<tr><td style="padding:{padding};">{content}</td></tr>'


def _section_head(
    base_url: str, icon: str, title: str, line: str | None = None, *, kicker: bool = False
) -> str:
    """Icon tile plus the section title; a kicker is the site's micro label."""

    heading = (
        _label(title)
        if kicker
        else (
            f'<h2 class="t1" style="margin:0;font-size:20px;line-height:26px;'
            f"font-weight:600;letter-spacing:-0.4px;color:{L['text1']};"
            f'">{escape(title)}</h2>'
        )
    )
    sub = _p(escape(line), "text2", size=14, line=20, margin="2px 0 0") if line else ""
    return _table(
        '<tr><td width="32" valign="top" style="width:32px;">'
        f"{_icon(base_url, icon)}</td>"
        f'<td valign="middle" style="padding:{"7px" if kicker else "3px"} 0 0 12px;">'
        f"{heading}{sub}</td></tr>"
    )


def _button(label: str, href: str, *, weekly: bool, width: int) -> str:
    """A bulletproof pill: VML for Outlook on Windows, a padded link elsewhere."""

    fill, text = (L["wfill"], L["won"]) if weekly else (L["ifill"], L["ion"])
    classes = "bw bwt" if weekly else "bi bit"
    safe = escape(label)
    return (
        "<!--[if mso]>"
        '<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" '
        'xmlns:w="urn:schemas-microsoft-com:office:word" '
        f'href="{_attr(href)}" style="height:48px;v-text-anchor:middle;'
        f'width:{width}px;" arcsize="50%" stroke="f" fillcolor="{fill}">'
        f'<w:anchorlock/><center style="color:{text};font-family:Segoe UI,Arial,'
        f'sans-serif;font-size:16px;font-weight:600;">{safe}</center>'
        "</v:roundrect><![endif]-->"
        "<!--[if !mso]><!-->"
        f'<a href="{_attr(href)}" class="{classes} btn" style="display:inline-block;'
        f"background-color:{fill};color:{text};border-radius:999px;"
        "padding:14px 26px;font-size:16px;line-height:20px;font-weight:600;"
        f'text-decoration:none;text-align:center;">{safe}</a>'
        "<!--<![endif]-->"
    )


def _actions(links: dict[str, str], compact: bool = False) -> str:
    """The calendar actions as one segmented pill, like the site's
    ROI % | Price toggle. Each segment is 44 px tall and the group fits a
    375 px phone on one line, with or without the phone rules.

    A compact group (one .ics segment) is used only when a very busy week
    would otherwise pass the size budget; see render_roundup."""

    edge = f"border:1px solid {L['line2']};"
    if compact:
        segments = (("+ Add to calendar (.ics)", links["ics"], f"{edge}border-radius:999px;"),)
    else:
        segments = (
            ("+ Google", links["google"], f"{edge}border-radius:999px 0 0 999px;"),
            ("+ Outlook", links["outlook"], f"{edge}border-left:0;"),
            ("+ Apple / .ics", links["ics"], f"{edge}border-left:0;border-radius:0 999px 999px 0;"),
        )
    cells = "".join(
        f'<td class="sp" style="{border}"><a href="{_attr(href)}" class="t1" '
        f'style="display:block;padding:12px;color:{L["text1"]};text-decoration:none;">'
        f"{escape(label)}</a></td>"
        for label, href, border in segments
    )
    return (
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0" '
        'style="border-collapse:separate;font-size:14px;line-height:18px;'
        f'font-weight:500;white-space:nowrap;"><tr>{cells}</tr></table>'
    )


# ---------------------------------------------------------------------------
# Timeline items


def _icon_name(item: dict[str, Any]) -> str:
    kind = str(item.get("kind") or "").lower()
    phases = {
        "new_moon": "moon-new",
        "first_quarter": "moon-first-quarter",
        "full_moon": "moon-full",
        "last_quarter": "moon-last-quarter",
    }
    if kind in phases:
        return phases[kind]
    if "eclipse" in kind:
        return "eclipse"
    if "ingress" in kind:
        return "ingress"
    if "station" in kind:
        return "station"
    if kind == "season":
        return "season"
    if "conjunction" in kind:
        return "orbit"
    item_id = str(item.get("id") or "")
    theme = str(item.get("theme") or "").lower()
    if item_id.startswith("finance:") or theme in {"finance", "politics"}:
        return "finance"
    if item_id.startswith("culture:") or theme.startswith("culture"):
        return "culture"
    if item_id.startswith("science:") or theme == "science":
        return "orbit"
    return "calendar"


def _when(item: dict[str, Any]) -> str:
    """IST first and strong, UTC after it; the UTC day when it differs."""

    moment = item_instant(item)
    if moment is None:
        return _span("All day", "text1", "font-weight:600;")
    ist = moment.astimezone(IST)
    utc = moment.astimezone(timezone.utc)
    utc_text = f" · {utc.strftime('%H:%M')} UTC"
    if utc.date() != ist.date():
        # The item sits under its IST day; name the UTC day beside it.
        utc_text += f" {_human_short(utc.date())}"
    return _span(f"{ist.strftime('%H:%M')} IST", "text1", "font-weight:600;") + _span(
        escape(utc_text), "text3"
    )


def _item_row(
    item: dict[str, Any],
    week: str,
    base_url: str,
    theme: str | None,
    first: bool,
    compact: bool = False,
) -> str:
    title = item_title(item)
    links = calendar_actions(item, week, base_url)
    theme_html = _span(f" · {escape(theme)}", "text3") if theme else ""
    border = "" if first else f"border-top:1px solid {L['line']};"
    # The actions sit under the icon by default, so they fit a phone even
    # where the phone rules are dropped; wider screens indent them under the
    # title (the .ind rule).
    return (
        f'<tr><td class="sl" style="{border}padding:{"12px" if first else "16px"} 0 16px;">'
        + _table(
            '<tr><td width="32" valign="top" style="width:32px;padding-top:2px;">'
            f"{_icon(base_url, _icon_name(item))}</td>"
            '<td valign="top" style="padding-left:14px;">'
            + _p(
                _link(title, page_url(item, base_url), "text1", underline=False),
                "text1",
                size=16,
                line=22,
                weight=600,
            )
            + _p(_when(item) + theme_html, "text2", size=14, line=20, margin="4px 0 0")
            + '</td></tr><tr><td colspan="2" class="ind" style="padding:12px 0 0;">'
            + _actions(links, compact)
            + "</td></tr>"
        )
        + "</td></tr>"
    )


def _day_label(item: dict[str, Any]) -> str:
    moment = item_instant(item)
    day = moment.astimezone(IST).date() if moment else item_date(item)
    return _human_short(day) if day else "Date to come"


def _timeline(
    items: list[dict[str, Any]],
    week: str,
    base_url: str,
    themes: dict[int, str] | None = None,
    compact: bool = False,
) -> str:
    if not items:
        return _p("No dates in this section.", "text2", size=14, line=20, margin="16px 0 0")
    grouped: dict[str, list[dict[str, Any]]] = {}
    for item in sorted(items, key=_sort_key):
        grouped.setdefault(_day_label(item), []).append(item)
    rows: list[str] = []
    for label, day_items in grouped.items():
        rows.append(
            f'<tr><td style="padding:22px 0 0;">{_label(label)}</td></tr>'
        )
        for index, item in enumerate(day_items):
            theme = (themes or {}).get(id(item)) or item.get("theme")
            rows.append(_item_row(item, week, base_url, theme, index == 0, compact))
    return _table("".join(rows))


# ---------------------------------------------------------------------------
# Charts, drawn in table cells: they follow dark mode, survive images-off and
# need no hosted image.


def _bar(height: int, colour_key: str, cls: str, width: int, radius: str) -> str:
    """One bar: a filled cell. bgcolor paints it everywhere; the class lets
    the dark rules repaint it."""

    return (
        '<table role="presentation" align="center" cellpadding="0" cellspacing="0" '
        f'border="0"><tr><td width="{width}" height="{height}" bgcolor="{L[colour_key]}" '
        f'class="{cls}" style="height:{height}px;border-radius:{radius};font-size:0;'
        'line-height:0;">&nbsp;</td></tr></table>'
    )


def _column_chart(
    values: list[float],
    labels: list[str],
    value_text: list[str],
    *,
    styles: list[tuple[str, str]],
    strong: list[bool],
    bar_width: int,
    height: int = 64,
) -> str:
    """Columns from a zero baseline; negative readings hang below the axis.

    Each column is one cell holding its figure, its bar and its label, so a
    screen reader reads "value, date" pairs in order. Every column has the
    same row heights, so the axis lines up across them.
    """

    top = max([0.0] + values)
    bottom = max([0.0] + [-value for value in values])
    span = top + bottom or 1.0
    up = round(height * top / span)
    down = height - up if bottom else 0
    width = f"{100 / len(values):.2f}%"
    empty = "font-size:0;line-height:0;"
    grid = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">'

    def size(value: float) -> int:
        return max(2, round(height * abs(value) / span)) if value else 0

    def text(html: str, role: str, bold: bool, pad: str) -> str:
        klass, colour = _text_style(role)
        weight = "font-weight:600;" if bold else ""
        return (
            f'<tr><td align="center" class="{klass}" style="padding:{pad};{colour}{weight}">'
            f"{html}</td></tr>"
        )

    columns = []
    for value, figure, label, (key, cls), is_strong in zip(
        values, value_text, labels, styles, strong
    ):
        rise = _bar(size(value), key, cls, bar_width, "4px 4px 0 0") if value > 0 else "&nbsp;"
        fall = (
            f'<tr><td align="center" valign="top" height="{down}" style="height:{down}px;{empty}">'
            + (_bar(size(value), key, cls, bar_width, "0 0 4px 4px") if value < 0 else "&nbsp;")
            + "</td></tr>"
            if down
            else ""
        )
        columns.append(
            f'<td width="{width}" valign="top">{grid}'
            + text(escape(figure), "text1" if is_strong else "text2", is_strong, "0 2px 6px")
            + f'<tr><td align="center" valign="bottom" height="{up}" style="height:{up}px;{empty}">'
            f"{rise}</td></tr>"
            f'<tr><td height="1" bgcolor="{L["line2"]}" class="bx" style="{empty}">&nbsp;</td></tr>'
            f"{fall}"
            + text(escape(label), "text3", False, "6px 2px 0")
            + "</table></td>"
        )
    return _table(
        f"<tr>{''.join(columns)}</tr>",
        "table-layout:fixed;font-size:13px;line-height:16px;"
        "font-variant-numeric:tabular-nums;white-space:nowrap;",
    )


# ---------------------------------------------------------------------------
# Sections


def _preheader(roundup: dict[str, Any]) -> str:
    facts: list[str] = []
    regime = roundup.get("regime") or {}
    if regime.get("score") is not None:
        facts.append(
            f"Core Index {_signed(float(regime['score']))} "
            f"{regime.get('label') or ''}".strip()
        )
    sky = roundup.get("sky_week_items") or roundup.get("sky") or []
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
    # The filler keeps the inbox preview from running on into the body copy.
    filler = "&#847;&zwnj;&nbsp;" * 40
    return (
        '<div style="display:none;font-size:1px;line-height:1px;max-height:0;'
        "max-width:0;opacity:0;overflow:hidden;mso-hide:all;"
        f'color:{L["page"]};">{escape(text)}{filler}</div>'
    )


def _wordmark(base_url: str, size: int = 17) -> str:
    """The site's brand: the planet mark, "strikehike" and a signal ".com"."""

    return (
        f'<a href="{_attr(base_url.rstrip("/") + "/")}" style="text-decoration:none;">'
        + _span(
            "strikehike",
            "text1",
            f"font-size:{size}px;line-height:20px;font-weight:600;letter-spacing:-0.5px;",
        )
        + _span(".com", "signal", f"font-size:{size - 4}px;line-height:20px;font-weight:500;")
        + "</a>"
    )


def _header(roundup: dict[str, Any], base_url: str) -> str:
    week = str(roundup.get("week") or "")
    page = f"{base_url.rstrip('/')}/this-week/{week}"
    mark = _img(_asset(base_url, "mark.png"), "", 32, 32, "border-radius:16px;")
    brand = (
        f'<table role="presentation" cellpadding="0" cellspacing="0" border="0" '
        f'bgcolor="{L["card"]}" class="sc" style="background-color:{L["card"]};'
        f"border:1px solid {L['line']};border-radius:999px;border-collapse:separate;\">"
        f'<tr><td style="padding:5px 0 5px 5px;">{mark}</td>'
        f'<td style="padding:0 16px 0 9px;">{_wordmark(base_url)}</td></tr></table>'
    )
    return _table(
        f'<tr><td valign="middle">{brand}</td>'
        '<td align="right" valign="middle" style="padding-left:12px;">'
        + _p(_link("View in browser", page), "text2", size=14, line=20)
        + "</td></tr>"
    )


def _hero(roundup: dict[str, Any]) -> str:
    week = str(roundup.get("week") or "")
    kicker = (
        f'<p class="ta" style="margin:0;font-size:13px;line-height:22px;'
        f"font-weight:600;letter-spacing:1.8px;text-transform:uppercase;"
        f'color:{L["accent"]};">'
        f'<span class="dot" style="color:{L["dot"]};font-size:11px;'
        f'letter-spacing:0;">&#9679;</span>&nbsp; Weekly roundup&nbsp; '
        f'<span class="ta sk" style="display:inline-block;padding:0 9px;'
        f"border:1px solid {L['softline']};border-radius:999px;"
        f"background-color:{L['soft']};color:{L['accent']};font-size:12px;"
        f'letter-spacing:1.4px;">{escape(week)}</span></p>'
    )
    title = (
        f'<h1 class="t1 h1" style="margin:14px 0 0;font-size:36px;line-height:40px;'
        f"font-weight:600;letter-spacing:-1.4px;color:{L['text1']};"
        f'">{escape(week_label(week))}</h1>'
    )
    dek = _p("This week: macro + sky", "text2", size=17, line=24, margin="8px 0 0")
    return kicker + title + dek


def _glance(roundup: dict[str, Any], base_url: str) -> str:
    """The week's headline summary: one factual line per section."""

    lines = roundup.get("lines") or {}
    rows: list[tuple[str, str, str]] = []
    if lines.get("dates") and roundup.get("themes"):
        rows.append(("calendar", "Dates", str(lines["dates"])))
    if lines.get("sky") and (roundup.get("sky_week_items") or roundup.get("sky")):
        rows.append(("moon-first-quarter", "Sky", str(lines["sky"])))
    if lines.get("activity") and roundup.get("activity"):
        rows.append(("orbit", "Activity", str(lines["activity"])))
    if lines.get("next") and roundup.get("next_two_weeks"):
        rows.append(("calendar-next", "Next", str(lines["next"])))
    if not rows:
        return ""
    body = "".join(
        f'<tr><td width="24" valign="top" style="width:24px;padding:{"0" if index == 0 else "10px"} 0 0;">'
        f"{_icon(base_url, icon, 24)}</td>"
        f'<td valign="top" style="padding:{"1px" if index == 0 else "11px"} 0 0 12px;">'
        + _p(
            _span(escape(name), "text1", "font-weight:600;")
            + _span(" · " + escape(line.strip()), "text2"),
            "text2",
            size=15,
            line=22,
        )
        + "</td></tr>"
        for index, (icon, name, line) in enumerate(rows)
    )
    return (
        f'<tr><td class="sp" style="padding:20px 0 0;border-top:1px solid {L["line2"]};">'
        + _table(body)
        + "</td></tr>"
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
    figure = (
        '<p style="margin:16px 0 0;font-variant-numeric:tabular-nums;">'
        f'<span class="t1 fig" style="font-size:52px;line-height:52px;'
        f"font-weight:300;letter-spacing:-2px;color:{L['text1']};\">{_signed(score)}</span>"
        f'&nbsp;&nbsp;<span class="t1 sp" style="display:inline-block;'
        f"vertical-align:middle;padding:2px 11px;border:1px solid {L['line2']};"
        f"border-radius:999px;font-size:14px;line-height:20px;font-weight:500;"
        f'color:{L["text1"]};">{escape(label)}</span></p>'
    )
    weekly = regime.get("weekly") or []
    chart = ""
    if len(weekly) >= 2:
        values = [float(point["score"]) for point in weekly]
        labels = []
        for point in weekly:
            day = _date(str(point.get("date") or ""))
            labels.append(_short(day) if day else "")
        last = len(values) - 1
        chart = (
            f'<div class="sl" style="margin:20px 0 0;padding:16px 0 0;'
            f'border-top:1px solid {L["line"]};">'
            + _p(
                f"Last {len(values)} weekly readings", "text3", size=13, line=18,
                margin="0 0 12px",
            )
            + _column_chart(
                values,
                labels,
                [_signed(value) for value in values],
                styles=[
                    ("barstrong", "bs") if index == last else ("bar", "bn")
                    for index in range(len(values))
                ],
                strong=[index == last for index in range(len(values))],
                bar_width=36,
            )
            + "</div>"
        )
    reading = _date(str(regime.get("as_of") or ""))
    footer = (
        _p(
            f"Latest reading: {escape(_human_day(reading))} · "
            + _link("Open the Regime chart →", base_url.rstrip("/") + "/regime", "accent"),
            "text2",
            size=14,
            line=20,
            margin="16px 0 0",
        )
        if reading
        else ""
    )
    return _card(
        _section_head(base_url, "regime", "Regime · Core Index", kicker=True)
        + figure
        + _p(escape(change_text), "text2", size=15, line=22, margin="10px 0 0")
        + chart
        + footer
    )


def _activity_card(roundup: dict[str, Any], base_url: str) -> str:
    activity = roundup.get("activity") or {}
    if not activity:
        return ""
    lines = roundup.get("lines") or {}
    daily = activity.get("daily") or []
    peak = activity.get("peak_date")
    chart = ""
    if daily:
        values = [float(point.get("score") or 0) for point in daily]
        days = [_date(str(point.get("date") or "")) for point in daily]
        chart = '<div style="margin:18px 0 0;">' + _column_chart(
            values,
            [day.strftime("%a") if day else "" for day in days],
            [f"{value:.0f}" for value in values],
            styles=[
                ("actpeak", "bp") if peak and point.get("date") == peak else ("act", "ba")
                for point in daily
            ],
            strong=[bool(peak) and point.get("date") == peak for point in daily],
            bar_width=22,
            height=56,
        ) + "</div>"
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
        closest_html = _p(
            f"Closest past sky to {escape(for_label)}: "
            + _link(str(closest.get("name") or "past date"), _join(base_url, closest_path), "text1")
            + f", {escape(_human_date(closest.get('date')))} "
            f"({escape(str(closest.get('similarity_percent') or ''))}% geometry match).",
            "text2",
            size=14,
            line=20,
            margin="18px 0 0",
        )
    note = str(activity.get("note") or "").strip()
    note_html = _p(escape(note), "text3", size=14, line=20, margin="6px 0 0") if note else ""
    return _card(
        _section_head(base_url, "orbit", "Sky activity", kicker=True)
        + _p(escape(str(lines.get("activity") or "")), "text1", size=16, line=24, margin="14px 0 0")
        + chart
        + closest_html
        + note_html
    )


def _list_card(
    base_url: str,
    icon: str,
    title: str,
    line: str | None,
    items: list[dict[str, Any]],
    week: str,
    themes: dict[int, str] | None = None,
    compact: bool = False,
) -> str:
    return _card(
        _section_head(base_url, icon, title, line)
        + _timeline(items, week, base_url, themes, compact)
    )


def _calendar_card(roundup: dict[str, Any], base_url: str) -> str:
    week = str(roundup.get("week") or "")
    kicker = (
        f'<p class="ta" style="margin:0;font-size:13px;line-height:18px;font-weight:600;'
        f"letter-spacing:1.8px;text-transform:uppercase;color:{L['accent']};"
        f'"><span class="dot" style="color:{L["dot"]};'
        f'font-size:11px;letter-spacing:0;">&#9679;</span>&nbsp; Calendar</p>'
    )
    return _card(
        _table(
            '<tr><td valign="top">'
            + kicker
            + '<h2 class="t1" style="margin:8px 0 0;font-size:22px;line-height:28px;'
            f"font-weight:600;letter-spacing:-0.5px;color:{L['text1']};"
            '">Save the dates</h2>'
            + _p(
                "This week plus the next two weeks, in one file.",
                "text2",
                size=15,
                line=22,
                margin="6px 0 0",
            )
            + "</td>"
            f'<td width="32" valign="top" align="right" style="width:32px;">'
            f"{_icon(base_url, 'calendar-plus')}</td></tr>"
        )
        + '<div style="margin:18px 0 0;">'
        + _button(
            "Add all these dates to your calendar",
            week_calendar_url(week, base_url),
            weekly=True,
            width=340,
        )
        + "</div>"
        + _p(
            _link("Subscribe to every StrikeHike date", subscribe_url(base_url), "text1"),
            "text1",
            size=14,
            line=20,
            margin="18px 0 0",
        )
        + _p(
            _link("Google Calendar users: subscribe here", google_subscribe_url(base_url)),
            "text2",
            size=14,
            line=20,
            margin="8px 0 0",
        ),
        soft=True,
    )


def _record_card(roundup: dict[str, Any], base_url: str) -> str:
    record = roundup.get("from_record") or {}
    if not record:
        return ""
    href = _join(base_url, str(record.get("path") or ""))
    return _card(
        _section_head(base_url, "record", "From the record", kicker=True)
        + _p(
            _link(str(record.get("title") or "Claim test"), href, "text1", underline=False),
            "text1",
            size=18,
            line=24,
            weight=600,
            margin="14px 0 0",
            extra="letter-spacing:-0.3px;",
        )
        + _p(escape(str(record.get("result") or "")), "text2", size=15, line=22, margin="6px 0 0")
        + _p(_link("See the test →", href, "accent"), "accent", size=14, line=20, margin="12px 0 0")
    )


def _ledger_row(base_url: str, ledger: dict[str, Any] | None) -> str:
    if not ledger:
        return ""
    ledger_url = f"{base_url.rstrip('/')}/ledger"
    label = f"Ledger #{ledger['seq']} · {str(ledger['hash'])[:12]}"
    return _row(
        _table(
            '<tr><td width="32" valign="top" style="width:32px;">'
            f"{_icon(base_url, 'ledger')}</td>"
            '<td valign="middle" style="padding-left:12px;">'
            + _p(
                _link(label, ledger_url, "text1", extra="font-variant-numeric:tabular-nums;"),
                "text1",
                size=14,
                line=20,
                weight=600,
            )
            + _p(
                "This roundup's fingerprint in the public ledger.",
                "text2",
                size=14,
                line=20,
            )
            + "</td></tr>"
        ),
        f"28px 0 0",
    )


def _footer(
    base_url: str,
    page: str,
    unsubscribe_url: str,
    postal_address: str,
) -> str:
    mark = _img(_asset(base_url, "mark.png"), "", 24, 24, "border-radius:12px;")
    brand = _table(
        f'<tr><td width="24" valign="middle" style="width:24px;">{mark}</td>'
        f'<td valign="middle" style="padding-left:8px;">{_wordmark(base_url, 15)}</td></tr>',
        attrs="",
    )
    postal = (
        _p(escape(postal_address), "text2", size=13, line=19, margin="12px 0 0")
        if postal_address
        else ""
    )
    return _row(
        brand
        + _p(escape(DISCLAIMER), "text2", size=13, line=19, margin="14px 0 0")
        + _p(escape(WHY), "text2", size=13, line=19, margin="8px 0 0")
        + _p(
            f'<a href="{_attr(unsubscribe_url)}" class="t1" style="color:{L["text1"]};'
            'text-decoration:underline;font-weight:600;">Unsubscribe in one click</a>'
            + _span("&nbsp; · &nbsp;", "text3")
            + _link("View in browser", page),
            "text2",
            size=13,
            line=19,
            margin="12px 0 0",
        )
        + postal,
        f"20px 0 0",
    )


def _style_blocks(base_url: str) -> str:
    """Two blocks: Gmail keeps the first even if it drops the second."""

    base = (
        "<style>"
        ":root{color-scheme:light dark;supported-color-schemes:light dark;}"
        "@font-face{font-family:'Onest';font-style:normal;font-weight:300 700;"
        f"font-display:swap;src:url({_asset(base_url, FONT_FILE)}) "
        "format('woff2');}"
        "body{margin:0!important;padding:0!important;width:100%!important;"
        "-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;}"
        "table,td{mso-table-lspace:0pt;mso-table-rspace:0pt;}"
        "img{-ms-interpolation-mode:bicubic;}"
        "a[x-apple-data-detectors]{color:inherit!important;text-decoration:none!important;}"
        "@media only screen and (min-width:481px){.ind{padding-left:46px!important;}}"
        "@media only screen and (max-width:480px){"
        ".px{padding-left:12px!important;padding-right:12px!important;}"
        ".cp{padding:20px!important;}"
        ".h1{font-size:30px!important;line-height:34px!important;letter-spacing:-1px!important;}"
        ".fig{font-size:46px!important;line-height:46px!important;}"
        ".btn{display:block!important;padding:14px 16px!important;font-size:15px!important;}"
        "}"
        "</style>"
    )
    rules = [
        ("sb", "background-color", "page"),
        ("sc", "background-color", "card"),
        ("sc", "border-color", "line"),
        ("sw", "background-color", "soft"),
        ("sw", "border-color", "softline"),
        ("sk", "background-color", "soft"),
        ("sk", "border-color", "softline"),
        ("sl", "border-color", "line"),
        ("sp", "border-color", "line2"),
        ("bw", "background-color", "wfill"),
        ("bi", "background-color", "ifill"),
        ("bn", "background-color", "bar"),
        ("bs", "background-color", "barstrong"),
        ("ba", "background-color", "act"),
        ("bp", "background-color", "actpeak"),
        ("bx", "background-color", "line2"),
        ("dot", "color", "dot"),
    ] + [(cls, "color", role) for role, cls in TEXT_CLASSES.items()]
    merged: dict[str, list[str]] = {}
    for cls, prop, role in rules:
        merged.setdefault(cls, []).append(f"{prop}:{DARK[role]}!important")
    dark = "".join(f".{cls}{{{';'.join(props)};}}" for cls, props in merged.items())
    # Outlook.com marks the elements it recolours in dark mode with
    # data-ogsc (text) and data-ogsb (backgrounds); give them the site's night.
    ogsc = "".join(
        f"[data-ogsc] .{cls}{{{';'.join(p for p in props if p.startswith('color'))};}}"
        for cls, props in merged.items()
        if any(p.startswith("color") for p in props)
    )
    ogsb = "".join(
        f"[data-ogsb] .{cls}{{{';'.join(p for p in props if not p.startswith('color'))};}}"
        for cls, props in merged.items()
        if any(not p.startswith("color") for p in props)
    )
    return base + (
        "<style>"
        f"@media (prefers-color-scheme:dark){{{dark}}}"
        f"{ogsc}{ogsb}"
        "</style>"
    )


def _html_document(inner: str, subject: str, base_url: str) -> str:
    return (
        "<!doctype html>"
        '<html lang="en" dir="ltr" xmlns="http://www.w3.org/1999/xhtml" '
        'xmlns:v="urn:schemas-microsoft-com:vml" '
        'xmlns:o="urn:schemas-microsoft-com:office:office">'
        "<head>"
        '<meta charset="utf-8" />'
        '<meta name="viewport" content="width=device-width, initial-scale=1" />'
        '<meta name="x-apple-disable-message-reformatting" />'
        '<meta name="format-detection" content="telephone=no,date=no,address=no,email=no,url=no" />'
        '<meta name="color-scheme" content="light dark" />'
        '<meta name="supported-color-schemes" content="light dark" />'
        f"<title>{escape(subject)}</title>"
        "<!--[if mso]><noscript><xml><o:OfficeDocumentSettings>"
        "<o:AllowPNG/><o:PixelsPerInch>96</o:PixelsPerInch>"
        "</o:OfficeDocumentSettings></xml></noscript>"
        "<style>table,td,p,a,span,h1,h2{font-family:'Segoe UI',Arial,sans-serif!important;"
        "mso-line-height-rule:exactly;}</style>"
        "<![endif]-->"
        f"{_style_blocks(base_url)}"
        "</head>"
        f'<body class="sb" style="margin:0;padding:0;background-color:{L["page"]};">'
        f"{inner}"
        "</body></html>"
    )


# ---------------------------------------------------------------------------
# Plain text


RULE = "─" * 36


def _text_item(item: dict[str, Any], theme: str | None) -> str:
    line = _sky_event_line(item) if item.get("at") and not item.get("start_date") else _event_line(item)
    return f"• {line}" + (f" · {theme}" if theme else "")


def _plain_text(
    roundup: dict[str, Any],
    *,
    label: str,
    page: str,
    base_url: str,
    unsubscribe_url: str,
    postal_address: str,
    ledger: dict[str, Any] | None,
    this_week: list[dict[str, Any]],
    theme_names: dict[int, str],
) -> str:
    week = str(roundup.get("week") or "")
    regime = roundup.get("regime") or {}
    lines = roundup.get("lines") or {}
    activity = roundup.get("activity") or {}
    next_two_weeks = roundup.get("next_two_weeks") or []
    from_record = roundup.get("from_record") or {}

    out = [
        f"STRIKEHIKE WEEKLY ROUNDUP · {week}",
        f"{label} · This week: macro + sky",
        "",
        f"Read it on the web: {page}",
        "",
    ]
    glance = [
        str(lines.get(key) or "").strip()
        for key, present in (
            ("dates", roundup.get("themes")),
            ("sky", roundup.get("sky_week_items") or roundup.get("sky")),
            ("activity", activity),
            ("next", next_two_weeks),
        )
        if present and lines.get(key)
    ]
    if glance:
        out.append("AT A GLANCE")
        out.extend(f"• {line}" for line in glance)
        out.append("")

    def section(title: str) -> None:
        out.extend([RULE, "", title])

    if regime:
        section("REGIME · CORE INDEX")
        line = str(lines.get("regime") or "").strip()
        out.append(line or "The latest Regime reading.")
        weekly = regime.get("weekly") or []
        if len(weekly) >= 2:
            readings = []
            for point in weekly:
                day = _date(str(point.get("date") or ""))
                readings.append(
                    f"{_signed(float(point['score']))} ({_short(day)})"
                    if day
                    else _signed(float(point["score"]))
                )
            out.append(f"Last {len(weekly)} weekly readings: " + ", ".join(readings))
        reading = _date(str(regime.get("as_of") or ""))
        if reading:
            out.append(f"Latest reading: {_human_day(reading)}.")
        out.extend([f"Regime chart: {base_url.rstrip('/')}/regime", ""])
    if this_week:
        section("THIS WEEK")
        summary = " ".join(
            str(lines.get(key) or "").strip()
            for key, present in (
                ("dates", roundup.get("themes")),
                ("sky", roundup.get("sky_week_items") or roundup.get("sky")),
            )
            if present and lines.get(key)
        )
        if summary:
            out.append(summary)
        out.extend(
            _text_item(item, theme_names.get(id(item)) or item.get("theme"))
            for item in sorted(this_week, key=_sort_key)
        )
        out.append("")
    if activity:
        section("SKY ACTIVITY")
        out.append(str(lines.get("activity") or "").strip())
        daily = activity.get("daily") or []
        if daily:
            days = []
            for point in daily:
                day = _date(str(point.get("date") or ""))
                days.append(f"{day.strftime('%a') if day else '?'} {point.get('score')}")
            out.append("By day: " + " · ".join(days))
        closest = activity.get("closest_past") or {}
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
            out.append(
                f"Closest past sky to {for_label}: {closest.get('name')}, "
                f"{_human_date(closest.get('date'))} "
                f"({closest.get('similarity_percent')}% geometry match)."
            )
        note = str(activity.get("note") or "").strip()
        if note:
            out.append(note)
        out.append("")
    if next_two_weeks:
        section("NEXT TWO WEEKS")
        out.append(str(lines.get("next") or "").strip())
        out.extend(
            _text_item(item, item.get("theme")) for item in sorted(next_two_weeks, key=_sort_key)
        )
        out.append("")
    if this_week or next_two_weeks:
        section("SAVE THE DATES")
        out.extend(
            [
                f"Add these dates: {week_calendar_url(week, base_url)}",
                f"Subscribe to every StrikeHike date: {subscribe_url(base_url)}",
                f"Google Calendar users: {google_subscribe_url(base_url)}",
                "",
            ]
        )
    if from_record:
        section("FROM THE RECORD")
        out.extend(
            [
                f"{from_record.get('title')} — {from_record.get('result')}",
                f"See the test: {_join(base_url, str(from_record.get('path') or ''))}",
                "",
            ]
        )
    out.extend([RULE, "", f"Read this week's roundup: {page}", ""])
    if ledger:
        out.append(
            f"Ledger #{ledger['seq']} · {str(ledger['hash'])[:12]} — "
            "strikehike.com/ledger"
        )
        out.extend(["This roundup's fingerprint in the public ledger.", ""])
    out.extend([DISCLAIMER, "", WHY, f"Unsubscribe: {unsubscribe_url}"])
    if postal_address:
        out.append(f"Postal address: {postal_address}")
    out.append("")
    return "\n".join(out)


# ---------------------------------------------------------------------------


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
    page = f"{base_url.rstrip('/')}/this-week/{week}"
    regime = roundup.get("regime") or {}
    lines = roundup.get("lines") or {}
    themes = roundup.get("themes") or []
    sky = roundup.get("sky") or []
    sky_items = roundup.get("sky_week_items") or []
    next_two_weeks = roundup.get("next_two_weeks") or []
    if roundup.get("schema") == 2 and regime.get("score") is not None:
        subject = (
            f"StrikeHike weekly · {label} · "
            f"Core Index {_signed(float(regime['score']))}"
        )
    else:
        subject = f"StrikeHike weekly · {label}"

    theme_names: dict[int, str] = {}
    this_week: list[dict[str, Any]] = []
    for theme in themes:
        for event in theme.get("events") or []:
            this_week.append(event)
            theme_names[id(event)] = str(theme.get("name") or "")
    this_week.extend(sky_items or sky)

    text = _plain_text(
        roundup,
        label=label,
        page=page,
        base_url=base_url,
        unsubscribe_url=unsubscribe_url,
        postal_address=postal_address,
        ledger=ledger,
        this_week=this_week,
        theme_names=theme_names,
    )

    week_line = " ".join(
        str(lines.get(key) or "").strip()
        for key, present in (("dates", themes), ("sky", sky_items or sky))
        if present and lines.get(key)
    )

    def html_for(compact: bool) -> str:
        blocks = (
            _regime_card(roundup, base_url),
            _list_card(
                base_url,
                "calendar",
                "This week",
                week_line or None,
                this_week,
                week,
                theme_names,
                compact,
            )
            if this_week
            else "",
            _activity_card(roundup, base_url),
            _list_card(
                base_url,
                "calendar-next",
                "Next two weeks",
                str(lines.get("next") or "").strip() or None,
                next_two_weeks,
                week,
                None,
                compact,
            )
            if next_two_weeks
            else "",
            _calendar_card(roundup, base_url) if this_week or next_two_weeks else "",
            _record_card(roundup, base_url),
        )
        cta = _row(
            '<div style="text-align:center;">'
            + _button("Read this week's roundup", page, weekly=False, width=280)
            + "</div>",
            "32px 0 0",
        )
        rule = (
            '<tr><td class="sp" height="1" style="height:1px;padding:0;'
            f"border-top:1px solid {L['line2']};font-size:0;line-height:0;\">&nbsp;</td></tr>"
        )
        content = (
            _row(_header(roundup, base_url))
            + _row(_hero(roundup), "36px 0 24px")
            + _glance(roundup, base_url)
            + _gap(12)
            + "".join(_gap(16) + _row(block) for block in blocks if block)
            + cta
            + _ledger_row(base_url, ledger)
            + _gap(24)
            + rule
            + _footer(base_url, page, unsubscribe_url, postal_address)
        )
        inner = (
            _preheader(roundup)
            + f'<div role="article" aria-roledescription="email" aria-label="{_attr(subject)}" '
            'lang="en" dir="ltr">'
            '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
            f'border="0" bgcolor="{L["page"]}" class="sb" style="width:100%;'
            f'background-color:{L["page"]};"><tr>'
            '<td align="center" class="px t1" style="padding:28px 16px 40px;'
            f"font-family:{FONT};color:{L['text1']};\">"
            '<!--[if mso]><table role="presentation" width="600" align="center" '
            'cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->'
            '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
            f'border="0" style="width:100%;max-width:{MAX_WIDTH}px;margin:0 auto;'
            'border-collapse:collapse;text-align:left;">'
            f"{content}</table>"
            "<!--[if mso]></td></tr></table><![endif]-->"
            "</td></tr></table></div>"
        )
        return _html_document(inner, subject, base_url)

    html = html_for(False)
    if len(html.encode("utf-8")) > HTML_BUDGET:
        # A very busy week: one .ics action per date keeps the footer, with
        # its unsubscribe link, clear of Gmail's clip at 102 KB. The week
        # file under "Save the dates" still carries every date.
        html = html_for(True)
    return Rendered(subject=subject, html=html, text=text)


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
