"""FRED release-date adapter (Finance).

Only the date is published by FRED, so every record is all-day.  The API key is
read from ``FRED_API_KEY`` at call time and is redacted from every error and
retry message; it never appears in the bundle.
"""

from __future__ import annotations

import json
import os
import random
import time
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

import requests

from ..models import EventKind, EventStatus, RawRecord, Verification
from ..registry import ReleaseSpec, SourceSpec
from ..security import redact_secrets
from ..text import normalize_text, parse_date
from . import SourceError, SourceExtraction

FRED_ENDPOINT = "https://api.stlouisfed.org/fred/release/dates"
MAX_DATES_PER_MONTH = 3
MONTHS = (
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
)


class FredError(SourceError):
    pass


class FredClient:
    """Small, bounded FRED client: 2 req/s, 20 s timeout, 3 retries."""

    def __init__(
        self,
        *,
        api_key: str,
        timeout: float = 20.0,
        min_interval: float = 0.5,
        max_retries: int = 3,
        session: requests.Session | None = None,
        sleep=time.sleep,
        monotonic=time.monotonic,
        rng: random.Random | None = None,
    ) -> None:
        self.api_key = api_key
        self.timeout = timeout
        self.min_interval = min_interval
        self.max_retries = max_retries
        self.session = session or requests.Session()
        self.sleep = sleep
        self.monotonic = monotonic
        self.rng = rng or random.Random()
        self._last_request: float | None = None

    def _redact(self, value: object) -> str:
        return redact_secrets(value, extra_secrets=[self.api_key])

    def _throttle(self) -> None:
        if self._last_request is not None:
            wait = self.min_interval - (self.monotonic() - self._last_request)
            if wait > 0:
                self.sleep(wait)
        self._last_request = self.monotonic()

    def _get(self, params: dict[str, Any]) -> dict[str, Any]:
        last_error: str | None = None
        request_params = dict(params, api_key=self.api_key, file_type="json")
        for attempt in range(self.max_retries + 1):
            self._throttle()
            try:
                response = self.session.get(
                    FRED_ENDPOINT, params=request_params, timeout=self.timeout
                )
            except requests.RequestException as exc:
                last_error = self._redact(f"FRED request failed: {exc}")
            else:
                if response.status_code == 200:
                    try:
                        payload = response.json()
                    except ValueError as exc:
                        last_error = self._redact(f"FRED returned invalid JSON: {exc}")
                    else:
                        if isinstance(payload, dict):
                            return payload
                        last_error = "FRED returned a non-object JSON payload"
                elif response.status_code == 429 or response.status_code >= 500:
                    last_error = self._redact(
                        f"FRED returned HTTP {response.status_code}: "
                        f"{response.text[:200]}"
                    )
                else:
                    raise FredError(
                        self._redact(
                            f"FRED returned HTTP {response.status_code}: "
                            f"{response.text[:200]}"
                        )
                    )
            if attempt < self.max_retries:
                delay = min(10.0, 1.0 * (2**attempt)) + self.rng.uniform(0.0, 0.5)
                self.sleep(delay)
        raise FredError(last_error or "FRED request failed after retries")

    def fetch_release_dates(
        self,
        release: ReleaseSpec,
        *,
        start: date,
        end: date,
        max_pages: int,
        page_limit: int,
    ) -> dict[str, Any]:
        dates: list[str] = []
        offset = 0
        total: int | None = None
        for page in range(max_pages):
            payload = self._get(
                {
                    "release_id": release.release_id,
                    "realtime_start": start.isoformat(),
                    "realtime_end": end.isoformat(),
                    "include_release_dates_with_no_data": "true",
                    "limit": page_limit,
                    "offset": offset,
                }
            )
            batch = payload.get("release_dates", [])
            if not isinstance(batch, list):
                raise FredError("FRED response has no release_dates list")
            if total is None:
                total = int(payload.get("count", len(batch)))
                if total > max_pages * page_limit:
                    raise FredError(
                        f"FRED release {release.release_id} needs {total} rows, "
                        f"beyond the {max_pages}-page budget"
                    )
            for row in batch:
                if not isinstance(row, dict):
                    raise FredError("FRED release_dates contains a non-object row")
                if int(row.get("release_id", -1)) != release.release_id:
                    raise FredError(
                        f"FRED returned release_id {row.get('release_id')!r} for "
                        f"release {release.release_id}"
                    )
                returned_name = normalize_text(row.get("release_name", ""))
                if returned_name and returned_name.casefold() != release.name.casefold():
                    raise FredError(
                        f"FRED name mismatch for release {release.release_id}: "
                        f"{returned_name!r} != {release.name!r}"
                    )
                dates.append(str(row.get("date", "")))
            offset += len(batch)
            if not batch or (total is not None and offset >= total):
                break
        else:
            if total is not None and offset < total:
                raise FredError(
                    f"FRED release {release.release_id} pagination exceeded "
                    f"{max_pages} pages"
                )
        return {
            "release_id": release.release_id,
            "release_name": release.name,
            "release_dates": [
                {"release_id": release.release_id, "release_name": release.name, "date": value}
                for value in dates
                if value
            ],
        }


def _release_records(
    source: SourceSpec,
    release: ReleaseSpec,
    payload: dict[str, Any],
    *,
    start: date,
    end: date,
    offline: bool = False,
) -> list[RawRecord]:
    dates: list[date] = []
    for row in payload.get("release_dates", []):
        try:
            value = parse_date(row.get("date", ""))
        except ValueError as exc:
            raise FredError(
                f"FRED returned an invalid date for release {release.release_id}: {exc}"
            ) from exc
        if start <= value <= end:
            dates.append(value)
    dates = sorted(set(dates))
    month_counts = Counter(value.strftime("%Y-%m") for value in dates)
    # A scheduled-release calendar has a few dates a month. A release that lists
    # more is a data-update feed (FRED's FOMC release updates every few days),
    # and showing it as events would mislead, so the source fails instead.
    busiest = max(month_counts.values(), default=0)
    if busiest > MAX_DATES_PER_MONTH:
        raise FredError(
            f"FRED release {release.release_id} lists {busiest} dates in one month; "
            "it is not a scheduled-release calendar"
        )
    month_seen: defaultdict[str, int] = defaultdict(int)
    records: list[RawRecord] = []
    for value in dates:
        month = value.strftime("%Y-%m")
        month_seen[month] += 1
        suffix = "" if month_counts[month] == 1 else f"-{month_seen[month]}"
        records.append(
            RawRecord(
                source_id=source.id,
                name=f"{release.name} ({MONTHS[value.month - 1]} {value.year})",
                theme=source.themes[0].value,
                start_date=value.isoformat(),
                description=(
                    ("Offline test fixture date, not a live FRED response. " if offline else "")
                    + f"Scheduled release date from FRED release {release.release_id} "
                    f"({release.name}). FRED publishes the date only; any release "
                    "time is confirmed on the issuing agency's calendar."
                ),
                external_id=f"{release.release_id}-{month}{suffix}",
                start_time=None,
                timezone="America/New_York",
                all_day=True,
                status=EventStatus.SCHEDULED.value,
                source_url=f"https://fred.stlouisfed.org/release?rid={release.release_id}",
                verification=Verification.VERIFIED.value,
                kind=EventKind.UPCOMING.value,
            )
        )
    return records


def extract(
    source: SourceSpec,
    *,
    today: date,
    now: datetime,
    offline_dir: Path | None = None,
) -> SourceExtraction:
    if not source.releases:
        raise FredError("fred_release_dates has no releases in sources.toml")
    end = today + timedelta(days=source.horizon_days)
    raw_payloads: dict[str, bytes] = {}
    records: list[RawRecord] = []

    if offline_dir is not None:
        for release in source.releases:
            path = offline_dir / "fred" / f"release_dates_{release.release_id}.json"
            if not path.exists():
                raise FredError(f"offline FRED fixture missing: {path.name}")
            raw_bytes = path.read_bytes()
            try:
                payload = json.loads(raw_bytes.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                raise FredError(f"offline FRED fixture is invalid: {path.name}: {exc}")
            if int(payload.get("release_id", -1)) != release.release_id:
                raise FredError(f"offline fixture {path.name} has the wrong release_id")
            raw_payloads[path.name] = raw_bytes
            records.extend(
                _release_records(
                    source, release, payload, start=today, end=end, offline=True
                )
            )
    else:
        api_key = os.environ.get("FRED_API_KEY", "").strip()
        if not api_key:
            raise FredError(
                "FRED_API_KEY is not set; Finance release dates were not fetched"
            )
        client = FredClient(api_key=api_key)
        for release in source.releases:
            payload = client.fetch_release_dates(
                release,
                start=today,
                end=end,
                max_pages=source.max_pages,
                page_limit=source.page_limit,
            )
            raw_payloads[f"release_dates_{release.release_id}.json"] = json.dumps(
                payload, ensure_ascii=False, sort_keys=True
            ).encode("utf-8")
            records.extend(
                _release_records(source, release, payload, start=today, end=end)
            )

    return SourceExtraction(
        source_id=source.id,
        records=tuple(records),
        raw_payloads=raw_payloads,
        fetched_at=now,
    )
