from __future__ import annotations

import json
from datetime import timedelta
from pathlib import Path

from astro_finance.events.gates import (
    GateContext,
    gate_dates,
    gate_distribution,
    gate_duplicates,
    gate_final_schema,
    gate_freshness,
    gate_historical,
    gate_reject_rate,
    gate_safety,
    run_gates,
)
from astro_finance.events.models import EventStatus, Theme
from conftest import NOW, TODAY, build_event, build_run, build_source


def _ctx(tmp_path: Path, events=None, **overrides) -> GateContext:
    source = build_source()
    payload = {
        "events": events or [],
        "source_specs": {"test_source": source},
        "source_runs": {"test_source": build_run()},
        "today": TODAY,
        "now": NOW,
        "previous_manifest": None,
        "extracted_counts": {"test_source": 1},
        "rejected_counts": {"test_source": 0},
        "data_dir": tmp_path / "events",
        "historical_source_sha256": "current",
        "previous_historical_source_sha256": None,
        "output_texts": {},
    }
    payload.update(overrides)
    return GateContext(**payload)


def _write_historical_seed(tmp_path: Path) -> Path:
    data_dir = tmp_path / "events"
    data_dir.mkdir(parents=True, exist_ok=True)
    seed = tmp_path / "historical_events.json"
    seed.write_text(
        json.dumps(
            {
                "events": [
                    {
                        "date": "2000-01-01",
                        "name": "Seed event",
                        "category": "Science",
                        "description": "From the seed.",
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    return seed


def test_final_schema_gate_passes_a_clean_set():
    result = gate_final_schema(_ctx(Path("."), [build_event()]))
    assert result.status == "pass"


def test_final_schema_gate_allows_an_archived_rescheduled_snapshot():
    archived = build_event(
        event_id="science:test_source:move-2027@2026-11-03",
        start_date=TODAY - timedelta(days=1),
        status=EventStatus.RESCHEDULED,
    )
    result = gate_final_schema(_ctx(Path("."), [archived]))
    assert result.status == "pass"


def test_final_schema_gate_fails_on_an_http_url():
    event = build_event(source_url="http://example.com/event")
    result = gate_final_schema(_ctx(Path("."), [event]))
    assert result.status == "fail"
    assert "schema errors" in result.reason


def test_reject_rate_gate_fails_above_five_percent():
    ctx = _ctx(
        Path("."),
        extracted_counts={"test_source": 10},
        rejected_counts={"test_source": 1},
    )
    result = gate_reject_rate(ctx)
    assert result.status == "fail"
    assert "10.0%" in result.reason


def test_reject_rate_gate_passes_at_the_boundary():
    ctx = _ctx(
        Path("."),
        extracted_counts={"test_source": 20},
        rejected_counts={"test_source": 1},
    )
    assert gate_reject_rate(ctx).status == "pass"


def test_historical_gate_fails_when_the_bundle_differs(tmp_path):
    _write_historical_seed(tmp_path)
    source = build_source(
        source_id="historical_curated",
        themes=tuple(Theme),
        url="https://example.com/history",
    )
    ctx = _ctx(
        tmp_path,
        events=[],
        source_specs={"historical_curated": source},
        source_runs={"historical_curated": build_run("historical_curated")},
    )
    result = gate_historical(ctx)
    assert result.status == "fail"
    assert "differs from the seed" in result.reason


def test_historical_gate_allows_an_explicit_seed_change(tmp_path):
    _write_historical_seed(tmp_path)
    source = build_source(
        source_id="historical_curated",
        themes=tuple(Theme),
        url="https://example.com/history",
    )
    ctx = _ctx(
        tmp_path,
        events=[],
        source_specs={"historical_curated": source},
        source_runs={"historical_curated": build_run("historical_curated")},
        previous_historical_source_sha256="older",
        historical_source_sha256="current",
    )
    result = gate_historical(ctx)
    assert result.status == "pass"
    assert "changed" in result.reason


def test_date_gate_fails_on_a_past_scheduled_upcoming_event():
    event = build_event(start_date=TODAY - timedelta(days=1))
    result = gate_dates(_ctx(Path("."), [event]))
    assert result.status == "fail"
    assert "before today" in result.reason


def test_date_gate_allows_a_past_cancelled_event():
    event = build_event(
        start_date=TODAY - timedelta(days=1),
        status=EventStatus.CANCELLED,
    )
    assert gate_dates(_ctx(Path("."), [event])).status == "pass"


def test_duplicate_gate_fails_on_duplicate_ids():
    one = build_event(event_id="science:test_source:one")
    two = build_event(event_id="science:test_source:one", name="Other")
    result = gate_duplicates(_ctx(Path("."), [one, two]))
    assert result.status == "fail"
    assert "duplicate event_id" in result.reason


def test_duplicate_gate_fails_on_same_theme_name_and_date():
    one = build_event(event_id="science:test_source:one", name="Same")
    two = build_event(event_id="science:test_source:two", name="Same")
    result = gate_duplicates(_ctx(Path("."), [one, two]))
    assert result.status == "fail"
    assert "theme+name+date" in result.reason


def test_freshness_gate_fails_when_the_last_success_is_too_old():
    source = build_source(freshness=7)
    run = build_run(fetched=False, last_success=NOW - timedelta(days=8))
    ctx = _ctx(
        Path("."),
        source_specs={"test_source": source},
        source_runs={"test_source": run},
    )
    result = gate_freshness(ctx)
    assert result.status == "fail"
    assert "older than 7 days" in result.reason


def test_freshness_gate_passes_with_a_recent_previous_success():
    source = build_source(freshness=7)
    run = build_run(fetched=False, last_success=NOW - timedelta(days=2))
    ctx = _ctx(
        Path("."),
        source_specs={"test_source": source},
        source_runs={"test_source": run},
    )
    assert gate_freshness(ctx).status == "pass"


def test_freshness_gate_reports_a_recent_success_after_a_failure():
    source = build_source(freshness=7)
    run = build_run(
        fetched=False,
        last_success=NOW - timedelta(days=2),
        error="FRED request failed",
    )
    ctx = _ctx(
        Path("."),
        source_specs={"test_source": source},
        source_runs={"test_source": run},
    )
    result = gate_freshness(ctx)
    assert result.status == "pass"
    assert "this run failed" in result.reason


def test_distribution_gate_fails_outside_the_band():
    previous = {"counts": {"Science": {"upcoming": {"scheduled": 10, "tentative": 0}}}}
    ctx = _ctx(Path("."), events=[], previous_manifest=previous)
    result = gate_distribution(ctx)
    assert result.status == "fail"
    assert "Science" in result.reason


def test_distribution_gate_only_warns_below_five():
    previous = {"counts": {"Science": {"upcoming": {"scheduled": 4, "tentative": 0}}}}
    ctx = _ctx(Path("."), events=[build_event()], previous_manifest=previous)
    result = gate_distribution(ctx)
    assert result.status == "pass"
    assert "warning only" in result.reason


def test_distribution_gate_passes_without_a_previous_bundle():
    assert gate_distribution(_ctx(Path("."), [build_event()])).status == "pass"


def test_safety_gate_fails_on_http_url():
    event = build_event(source_url="http://example.com/event")
    result = gate_safety(_ctx(Path("."), [event]))
    assert result.status == "fail"
    assert "not https" in result.reason


def test_safety_gate_fails_on_a_secret_in_an_output_file():
    ctx = _ctx(Path("."), [build_event()], output_texts={"events.json": '{"k":"api_key=abc123"}'})
    result = gate_safety(ctx)
    assert result.status == "fail"
    assert "api_key" in result.reason


def test_safety_gate_ignores_a_sha256_digest():
    event = build_event()
    ctx = _ctx(
        Path("."),
        [event],
        output_texts={"events.json": json.dumps(event.to_dict())},
    )
    assert gate_safety(ctx).status == "pass"


def test_run_gates_returns_every_gate():
    results = run_gates(_ctx(Path("."), [build_event()]))
    assert {result.gate_id for result in results} == {
        "final_schema",
        "reject_rate",
        "historical_immutable",
        "date_integrity",
        "duplicate_integrity",
        "source_freshness",
        "distribution_shift",
        "safety",
    }
