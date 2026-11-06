"""Per-event authority pages, applied while the bundle is built.

An authority URL is a page that names one specific event: NASA's page for that
eclipse, the official per-year table that lists that solstice, or the central
bank's calendar that lists that meeting date.  It is what lets an event page be
indexed (D-06); a generic method link such as the Swiss Ephemeris homepage does
not count.

Every page below was opened on 2026-11-06 and lists the date in its table.  A
record gets an authority only when its source, its kind of event and its date
all match an entry here, so a moved or newly computed event never inherits a
page that does not name it.  Add an entry only after opening the page.
"""

from __future__ import annotations

import re
from dataclasses import replace
from datetime import date

from .models import RawRecord, Theme
from .text import parse_date

VERIFIED_ON = date(2026, 11, 6)

# NASA GSFC eclipse pages (Fred Espenak), linked from the decade tables
# https://eclipse.gsfc.nasa.gov/SEdecade/SEdecade2021.html and
# https://eclipse.gsfc.nasa.gov/LEdecade/LEdecade2021.html, which list every
# 2027 eclipse: two solar and three lunar.
#
# Solar: the eclipse's path page, titled "Path of <Type> Solar Eclipse of
# <YYYY Mon DD>", where the letter is the type (T total, A annular, H hybrid):
#   https://eclipse.gsfc.nasa.gov/SEpath/SEpath2001/SE{YYYY}{Mon}{DD}{T|A|H}path.html
# Lunar: the eclipse's figure, headed "<Type> Lunar Eclipse of <YYYY Mon DD>"
# (T total, P partial, N penumbral):
#   https://eclipse.gsfc.nasa.gov/LEplot/LEplot2001/LE{YYYY}{Mon}{DD}{T|P|N}.pdf
NASA_ECLIPSES: dict[tuple[str, str, date], str] = {
    ("solar", "annular", date(2027, 2, 6)): (
        "https://eclipse.gsfc.nasa.gov/SEpath/SEpath2001/SE2027Feb06Apath.html"
    ),
    ("lunar", "penumbral", date(2027, 2, 20)): (
        "https://eclipse.gsfc.nasa.gov/LEplot/LEplot2001/LE2027Feb20N.pdf"
    ),
    ("lunar", "penumbral", date(2027, 7, 18)): (
        "https://eclipse.gsfc.nasa.gov/LEplot/LEplot2001/LE2027Jul18N.pdf"
    ),
    ("solar", "total", date(2027, 8, 2)): (
        "https://eclipse.gsfc.nasa.gov/SEpath/SEpath2001/SE2027Aug02Tpath.html"
    ),
    ("lunar", "penumbral", date(2027, 8, 17)): (
        "https://eclipse.gsfc.nasa.gov/LEplot/LEplot2001/LE2027Aug17N.pdf"
    ),
}

# US Naval Observatory, "Earth's Seasons - Equinoxes, Solstices, Perihelion,
# and Aphelion": one table per year, in Universal Time:
#   https://aa.usno.navy.mil/calculated/seasons?year={YYYY}&tz=0.00&tz_sign=-1&tz_label=false&dst=false&submit=Get+Data
USNO_SEASONS_URL = (
    "https://aa.usno.navy.mil/calculated/seasons?year={year}"
    "&tz=0.00&tz_sign=-1&tz_label=false&dst=false&submit=Get+Data"
)
USNO_SEASONS: dict[tuple[str, str, int], date] = {
    ("equinox", "march", 2026): date(2026, 3, 20),
    ("solstice", "june", 2026): date(2026, 6, 21),
    ("equinox", "september", 2026): date(2026, 9, 23),
    ("solstice", "december", 2026): date(2026, 12, 21),
    ("equinox", "march", 2027): date(2027, 3, 20),
    ("solstice", "june", 2027): date(2027, 6, 21),
    ("equinox", "september", 2027): date(2027, 9, 23),
    ("solstice", "december", 2027): date(2027, 12, 22),
}

# Central-bank meeting calendars.  Each page lists the meeting dates; the date
# here is the decision day, which is the day the curated record carries.
#
# Federal Reserve, "Meeting calendars, statements, and minutes": two-day
# meetings, decision on the second day ("Each meeting date is tentative until
# confirmed at the meeting immediately preceding it").
#   https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm
# Bank of England, "Monetary Policy Committee dates for 2026 and 2027".
#   https://www.bankofengland.co.uk/monetary-policy/upcoming-mpc-dates
# ECB, "Meetings of the Governing Council and General Council": monetary policy
# meetings, decision on Day 2.
#   https://www.ecb.europa.eu/press/calendars/mgcgc/html/index.en.html
CENTRAL_BANK_CALENDARS: tuple[tuple[str, str, frozenset[date]], ...] = (
    (
        "fomc-",
        "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm",
        frozenset(
            {
                date(2026, 12, 9),
                date(2027, 1, 27),
                date(2027, 3, 17),
                date(2027, 4, 28),
                date(2027, 6, 9),
                date(2027, 7, 28),
                date(2027, 9, 15),
                date(2027, 10, 27),
                date(2027, 12, 8),
            }
        ),
    ),
    (
        "boe-mpc-",
        "https://www.bankofengland.co.uk/monetary-policy/upcoming-mpc-dates",
        frozenset(
            {
                date(2026, 11, 5),
                date(2026, 12, 17),
                date(2027, 2, 4),
                date(2027, 3, 18),
                date(2027, 4, 29),
                date(2027, 6, 17),
                date(2027, 7, 29),
                date(2027, 9, 16),
                date(2027, 11, 4),
                date(2027, 12, 16),
            }
        ),
    ),
    (
        "ecb-gc-",
        "https://www.ecb.europa.eu/press/calendars/mgcgc/html/index.en.html",
        frozenset(
            {
                date(2026, 12, 17),
                date(2027, 2, 4),
                date(2027, 3, 18),
                date(2027, 4, 29),
                date(2027, 6, 10),
                date(2027, 7, 22),
                date(2027, 9, 9),
                date(2027, 10, 28),
            }
        ),
    ),
)

_ECLIPSE_ID = re.compile(
    r"^(solar|lunar)-eclipse-(total|annular|hybrid|partial|penumbral)-\d{4}-\d{2}-\d{2}$"
)
_SEASON_ID = re.compile(
    r"^(equinox|solstice)-(march|june|september|december)-(\d{4})$"
)


def _astronomy_authority(external_id: str, start_date: date) -> str | None:
    eclipse = _ECLIPSE_ID.match(external_id)
    if eclipse:
        return NASA_ECLIPSES.get((eclipse.group(1), eclipse.group(2), start_date))
    season = _SEASON_ID.match(external_id)
    if season:
        key = (season.group(1), season.group(2), int(season.group(3)))
        if USNO_SEASONS.get(key) == start_date:
            return USNO_SEASONS_URL.format(year=start_date.year)
    return None


def _central_bank_authority(external_id: str, start_date: date) -> str | None:
    for prefix, url, dates in CENTRAL_BANK_CALENDARS:
        if external_id.startswith(prefix):
            return url if start_date in dates else None
    return None


def authority_for(record: RawRecord) -> str | None:
    """The page that names this event, or ``None`` when none was verified."""

    external_id = record.external_id or ""
    try:
        start_date = parse_date(record.start_date)
    except (TypeError, ValueError):
        return None
    if record.source_id == "astronomy_computed" and record.theme == Theme.SCIENCE.value:
        return _astronomy_authority(external_id, start_date)
    if record.source_id == "curated_upcoming" and record.theme == Theme.FINANCE.value:
        return _central_bank_authority(external_id, start_date)
    return None


def apply_authority(record: RawRecord) -> RawRecord:
    """Attach a verified authority page; never override one a source supplied."""

    if record.authority_url:
        return record
    url = authority_for(record)
    if url is None:
        return record
    return replace(record, authority_url=url)
