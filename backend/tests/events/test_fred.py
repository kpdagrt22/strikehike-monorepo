from __future__ import annotations

import json
import random
from datetime import date
from pathlib import Path

import pytest
import requests

from astro_finance.events.models import Theme, Verification
from astro_finance.events.registry import ReleaseSpec
from astro_finance.events.sources.fred import (
    FredClient,
    FredError,
    _release_records,
    extract,
)
from conftest import FIXTURES, NOW, TODAY, build_source


class FakeResponse:
    def __init__(self, status_code: int, payload: dict | None = None, text: str = ""):
        self.status_code = status_code
        self._payload = payload
        self.text = text

    def json(self):
        if self._payload is None:
            raise ValueError("not JSON")
        return self._payload


class FakeSession:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def get(self, url, params=None, timeout=None):
        self.calls.append({"url": url, "params": dict(params or {}), "timeout": timeout})
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response


def _release() -> ReleaseSpec:
    return ReleaseSpec(101, "FOMC Press Release", date(2026, 11, 3))


def _payload(dates, name="FOMC Press Release", count=None):
    return {
        "release_id": 101,
        "release_name": name,
        "count": len(dates) if count is None else count,
        "release_dates": [
            {"release_id": 101, "release_name": name, "date": value} for value in dates
        ],
    }


def _client(session, **overrides):
    payload = {
        "api_key": "SECRET-KEY",
        "session": session,
        "min_interval": 0.0,
        "sleep": lambda _: None,
        "rng": random.Random(0),
    }
    payload.update(overrides)
    return FredClient(**payload)


def test_fred_client_fetches_release_dates():
    session = FakeSession([FakeResponse(200, _payload(["2026-12-09"]))])
    payload = _client(session).fetch_release_dates(
        _release(), start=TODAY, end=date(2027, 11, 3), max_pages=3, page_limit=100
    )
    assert payload["release_dates"][0]["date"] == "2026-12-09"
    assert session.calls[0]["timeout"] == 20.0
    assert session.calls[0]["params"]["include_release_dates_with_no_data"] == "true"


def test_fred_client_retries_5xx_with_backoff():
    sleeps = []
    session = FakeSession(
        [FakeResponse(500, text="boom"), FakeResponse(200, _payload(["2026-12-09"]))]
    )
    client = _client(session, sleep=sleeps.append)
    client.fetch_release_dates(
        _release(), start=TODAY, end=date(2027, 11, 3), max_pages=3, page_limit=100
    )
    assert len(session.calls) == 2
    assert sleeps and sleeps[0] > 0


def test_fred_client_stops_after_three_retries():
    session = FakeSession([FakeResponse(500, text="boom") for _ in range(4)])
    with pytest.raises(FredError, match="HTTP 500"):
        _client(session, sleep=lambda _: None).fetch_release_dates(
            _release(), start=TODAY, end=date(2027, 11, 3), max_pages=3, page_limit=100
        )
    assert len(session.calls) == 4


def test_fred_client_does_not_retry_4xx():
    session = FakeSession([FakeResponse(400, text="bad request"), FakeResponse(200, {})])
    with pytest.raises(FredError, match="HTTP 400"):
        _client(session).fetch_release_dates(
            _release(), start=TODAY, end=date(2027, 11, 3), max_pages=3, page_limit=100
        )
    assert len(session.calls) == 1


def test_fred_client_paginates_and_stops_at_count():
    first = _payload(["2026-12-09"], count=2)
    second = _payload(["2027-01-27"], count=2)
    session = FakeSession([FakeResponse(200, first), FakeResponse(200, second)])
    payload = _client(session).fetch_release_dates(
        _release(), start=TODAY, end=date(2027, 11, 3), max_pages=5, page_limit=1
    )
    assert [row["date"] for row in payload["release_dates"]] == [
        "2026-12-09",
        "2027-01-27",
    ]
    assert session.calls[0]["params"]["offset"] == 0
    assert session.calls[1]["params"]["offset"] == 1


def test_fred_client_refuses_a_pagination_budget_overrun():
    session = FakeSession([FakeResponse(200, _payload(["2026-12-09"], count=10))])
    with pytest.raises(FredError, match="page budget"):
        _client(session).fetch_release_dates(
            _release(), start=TODAY, end=date(2027, 11, 3), max_pages=2, page_limit=1
        )


def test_fred_client_rejects_a_release_name_mismatch():
    session = FakeSession([FakeResponse(200, _payload(["2026-12-09"], name="Other"))])
    with pytest.raises(FredError, match="name mismatch"):
        _client(session).fetch_release_dates(
            _release(), start=TODAY, end=date(2027, 11, 3), max_pages=3, page_limit=100
        )


def test_fred_errors_redact_the_api_key():
    session = FakeSession(
        [FakeResponse(500, text="api_key=SECRET-KEY exploded")]
    )
    with pytest.raises(FredError) as captured:
        _client(session, max_retries=0).fetch_release_dates(
            _release(), start=TODAY, end=date(2027, 11, 3), max_pages=3, page_limit=100
        )
    assert "SECRET-KEY" not in str(captured.value)
    assert "REDACTED" in str(captured.value)


def test_fred_request_exceptions_are_redacted():
    session = FakeSession([requests.ConnectionError("url?api_key=SECRET-KEY")])
    with pytest.raises(FredError) as captured:
        _client(session, max_retries=0).fetch_release_dates(
            _release(), start=TODAY, end=date(2027, 11, 3), max_pages=3, page_limit=100
        )
    assert "SECRET-KEY" not in str(captured.value)


def test_fred_client_rate_limits_to_two_requests_per_second():
    sleeps = []
    clock = [0.0]
    session = FakeSession(
        [
            FakeResponse(200, _payload(["2026-12-09"], count=2)),
            FakeResponse(200, _payload(["2027-01-27"], count=2)),
        ]
    )
    client = _client(
        session,
        min_interval=0.5,
        monotonic=lambda: clock[0],
        sleep=sleeps.append,
    )
    client.fetch_release_dates(
        _release(), start=TODAY, end=date(2027, 11, 3), max_pages=3, page_limit=1
    )
    assert 0.5 in sleeps


def test_release_records_filter_the_window_and_build_monthly_ids():
    source = build_source(
        source_id="fred_release_dates",
        themes=(Theme.FINANCE,),
        verification=Verification.VERIFIED,
    )
    payload = _payload(
        ["2026-11-02", "2026-11-05", "2026-11-20", "2027-11-04"]
    )
    records = _release_records(
        source, _release(), payload, start=TODAY, end=date(2027, 11, 3)
    )
    assert [record.start_date for record in records] == ["2026-11-05", "2026-11-20"]
    assert [record.external_id for record in records] == [
        "101-2026-11-1",
        "101-2026-11-2",
    ]
    assert all(record.all_day for record in records)
    assert all(record.timezone == "America/New_York" for record in records)
    assert all(record.source_url.startswith("https://") for record in records)


def test_offline_fixture_extraction_returns_realistic_records():
    from astro_finance.events.registry import load_registry

    source = load_registry().by_id()["fred_release_dates"]
    extraction = extract(source, today=TODAY, now=NOW, offline_dir=FIXTURES / "offline")
    assert len(extraction.records) == 45
    assert all(record.verification == "verified" for record in extraction.records)
    assert all(TODAY.isoformat() <= record.start_date <= "2027-11-03" for record in extraction.records)
    assert len({record.external_id for record in extraction.records}) == 45
    assert len(extraction.raw_payloads) == 5


def test_missing_offline_fixture_is_an_error(tmp_path):
    from astro_finance.events.registry import load_registry

    source = load_registry().by_id()["fred_release_dates"]
    with pytest.raises(FredError, match="fixture missing"):
        extract(source, today=TODAY, now=NOW, offline_dir=tmp_path)


def test_missing_api_key_is_an_honest_error(monkeypatch):
    from astro_finance.events.registry import load_registry

    monkeypatch.delenv("FRED_API_KEY", raising=False)
    source = load_registry().by_id()["fred_release_dates"]
    with pytest.raises(FredError, match="FRED_API_KEY is not set"):
        extract(source, today=TODAY, now=NOW, offline_dir=None)
