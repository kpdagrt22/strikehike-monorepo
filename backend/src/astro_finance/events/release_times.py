"""Official release times for Finance series, applied while the bundle is built.

Every time below was read on the issuing agency's own page on 2026-11-05.  A
series without a confirmed time stays all-day: the sources publish dates, and
StrikeHike does not guess a time.  This module is deliberately part of the
builder rather than of a committed bundle, so a later weekly build carries the
times into the bundle and the API.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, replace
from datetime import time

from .models import RawRecord, Theme

_FRED_EXTERNAL_ID = re.compile(r"^(\d+)-")


@dataclass(frozen=True, slots=True)
class ReleaseTime:
    start_time: time
    timezone: str
    source_url: str


# FRED release ids are declared in data/events/sources.toml.
#
# BLS Employment Situation: the release schedule lists 08:30 AM and the release
# itself is embargoed until "8:30 a.m. (ET)".
# https://www.bls.gov/schedule/news_release/empsit.htm
# https://www.bls.gov/news.release/empsit.nr0.htm
#
# BLS Consumer Price Index: the release schedule lists 08:30 AM.
# https://www.bls.gov/schedule/news_release/cpi.htm
FRED_RELEASE_TIMES: dict[int, ReleaseTime] = {
    50: ReleaseTime(time(8, 30), "America/New_York", "https://www.bls.gov/schedule/news_release/empsit.htm"),
    10: ReleaseTime(time(8, 30), "America/New_York", "https://www.bls.gov/schedule/news_release/cpi.htm"),
    # BEA GDP: the release schedule lists 8:30 AM, and the release is embargoed
    # until "8:30 a.m. EDT" (or EST outside daylight time).
    # https://www.bea.gov/news/schedule
    # https://www.bea.gov/news/2026/gdp-advance-estimate-3rd-quarter-2026
    53: ReleaseTime(time(8, 30), "America/New_York", "https://www.bea.gov/news/schedule"),
    # BEA Personal Income and Outlays: same release calendar, "8:30 a.m. EDT"
    # on the release and "8:30 a.m. EST" on the next one.
    # https://www.bea.gov/news/2026/personal-income-and-outlays-september-2026
    54: ReleaseTime(time(8, 30), "America/New_York", "https://www.bea.gov/news/schedule"),
}

# Curated decisions use stable external ids from data/events/curated/finance.toml.
#
# FOMC: the statement page says "For release at 2:00 p.m. EDT"; the meeting
# calendar gives the decision day.
# https://www.federalreserve.gov/newsevents/pressreleases/monetary20261028a.htm
# https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm
#
# Bank of England MPC: "We publish the MPC's decision ... at 12 noon on the day
# of the announcement."
# https://www.bankofengland.co.uk/monetary-policy
#
# ECB Governing Council: the "Monetary policy decisions" press release is
# timestamped 14:15 CET in the ECB's own press feed; the decision page then
# gives the 14:45 CET press conference.
# https://www.ecb.europa.eu/rss/press.html
# https://www.ecb.europa.eu/press/pr/date/2026/html/ecb.mp261029~9a493adf17.en.html
CURATED_RELEASE_TIMES: tuple[tuple[str, ReleaseTime], ...] = (
    (
        "fomc-",
        ReleaseTime(
            time(14, 0),
            "America/New_York",
            "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm",
        ),
    ),
    (
        "boe-mpc-",
        ReleaseTime(
            time(12, 0),
            "Europe/London",
            "https://www.bankofengland.co.uk/monetary-policy/upcoming-mpc-dates",
        ),
    ),
    (
        "ecb-gc-",
        ReleaseTime(
            time(14, 15),
            "Europe/Berlin",
            "https://www.ecb.europa.eu/press/calendars/mgcgc/html/index.en.html",
        ),
    ),
)


def release_time_for(record: RawRecord) -> ReleaseTime | None:
    """Return the confirmed time for this record, or ``None`` to stay all-day."""

    if record.theme != Theme.FINANCE.value:
        return None
    external_id = record.external_id or ""
    if record.source_id == "fred_release_dates":
        match = _FRED_EXTERNAL_ID.match(external_id)
        if match:
            return FRED_RELEASE_TIMES.get(int(match.group(1)))
        return None
    if record.source_id == "curated_upcoming":
        for prefix, value in CURATED_RELEASE_TIMES:
            if external_id.startswith(prefix):
                return value
    return None


def apply_release_time(record: RawRecord) -> RawRecord:
    """Set an official time when one is confirmed; never override source data."""

    if not record.all_day or record.start_time:
        return record
    value = release_time_for(record)
    if value is None:
        return record
    return replace(
        record,
        start_time=value.start_time.isoformat(timespec="seconds"),
        timezone=value.timezone,
        all_day=False,
    )
