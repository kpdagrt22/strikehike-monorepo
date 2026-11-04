from __future__ import annotations

import json
import shutil
from datetime import timedelta
from pathlib import Path

from astro_finance.events.pipeline import PipelineOptions, run_pipeline
from astro_finance.events.registry import default_data_dir
from conftest import FIXTURES, NOW, TODAY


def _copy_data(tmp_path: Path) -> Path:
    source_dir = default_data_dir()
    target_dir = tmp_path / "data" / "events"
    shutil.copytree(source_dir, target_dir)
    shutil.copy(
        source_dir.parent / "historical_events.json",
        tmp_path / "data" / "historical_events.json",
    )
    return target_dir


def _run(tmp_path: Path, data_dir: Path, *, previous: Path | None = None, name: str = "out"):
    return run_pipeline(
        PipelineOptions(
            out_dir=tmp_path / name,
            previous_dir=previous,
            today=TODAY,
            now=NOW,
            data_dir=data_dir,
            offline_dir=FIXTURES / "offline",
            execution_id=f"run-{name}",
            created_at=NOW,
        )
    )


def test_pipeline_writes_stage_records_and_raw_cache(tmp_path):
    data_dir = _copy_data(tmp_path)
    result = _run(tmp_path, data_dir)
    assert not result.publishable
    assert result.exit_code == 2
    log_path = result.out_dir / "runs" / "run-out.jsonl"
    records = [json.loads(line) for line in log_path.read_text("utf-8").splitlines()]
    assert [record["stage"] for record in records] == [
        "discovery",
        "extraction",
        "normalization",
        "validation",
        "deduplication",
        "lifecycle",
        "enrichment",
        "theme_classification",
        "dataset_creation",
        "quality_report",
    ]
    assert all(record["status"] == "ok" for record in records)
    assert all(record["execution_id"] == "run-out" for record in records)
    assert records[0]["data_version"] is None
    assert records[-1]["data_version"] == result.bundle_version
    assert (result.out_dir / "raw" / "historical_curated" / "historical_events.json").exists()
    assert (result.out_dir / "raw" / "fred_release_dates" / "release_dates_101.json").exists()
    assert (result.out_dir / "raw" / "astronomy_computed" / "computed_events.json").exists()
    assert (result.out_dir / "raw" / "curated_upcoming" / "finance.toml").exists()
    rejects = json.loads((result.out_dir / "rejects.json").read_text("utf-8"))
    assert rejects["rejects"] == []


def test_pipeline_reschedule_archives_the_previous_record(tmp_path):
    data_dir = _copy_data(tmp_path)
    first = _run(tmp_path, data_dir, name="first")
    finance = data_dir / "curated" / "finance.toml"
    text = finance.read_text("utf-8")
    assert 'date = "2026-11-05"' in text
    finance.write_text(
        text.replace('date = "2026-11-05"', 'date = "2026-11-06"'), encoding="utf-8"
    )
    second = _run(tmp_path, data_dir, previous=first.bundle_dir, name="second")
    payload = json.loads((second.bundle_dir / "events.json").read_text("utf-8"))
    events = payload["events"]
    family = [
        event
        for event in events
        if str(event["event_id"]).startswith(
            "finance:curated_upcoming:boe-mpc-2026-11"
        )
    ]
    assert {event["status"] for event in family} == {"scheduled", "rescheduled"}
    archived = next(event for event in family if event["status"] == "rescheduled")
    moved = next(event for event in family if event["status"] == "scheduled")
    assert archived["start_date"] == "2026-11-05"
    assert moved["start_date"] == "2026-11-06"
    assert moved["supersedes"] == archived["event_id"]
    assert second.bundle_version != first.bundle_version
    assert second.publishable is False
    assert second.exit_code == 2


def test_pipeline_marks_missing_curated_events_unverified_after_two_runs(tmp_path):
    data_dir = _copy_data(tmp_path)
    first = _run(tmp_path, data_dir, name="first")
    (data_dir / "curated" / "finance.toml").unlink()

    second = _run(tmp_path, data_dir, previous=first.bundle_dir, name="second")
    payload = json.loads((second.bundle_dir / "events.json").read_text("utf-8"))
    boe = [
        event
        for event in payload["events"]
        if event["event_id"] == "finance:curated_upcoming:boe-mpc-2026-11"
    ]
    assert len(boe) == 1
    assert boe[0]["status"] == "scheduled"
    assert boe[0]["missing_runs"] == 1

    third = _run(tmp_path, data_dir, previous=second.bundle_dir, name="third")
    payload = json.loads((third.bundle_dir / "events.json").read_text("utf-8"))
    boe = [
        event
        for event in payload["events"]
        if event["event_id"] == "finance:curated_upcoming:boe-mpc-2026-11"
    ]
    assert boe[0]["status"] == "unverified"
    assert boe[0]["missing_runs"] == 2


def test_pipeline_adopts_a_changed_historical_seed(tmp_path):
    data_dir = _copy_data(tmp_path)
    first = _run(tmp_path, data_dir, name="first")
    seed = data_dir.parent / "historical_events.json"
    payload = json.loads(seed.read_text("utf-8"))
    payload["events"][0]["description"] = "Changed by the owner."
    seed.write_text(json.dumps(payload), encoding="utf-8")

    second = _run(tmp_path, data_dir, previous=first.bundle_dir, name="second")
    events = json.loads((second.bundle_dir / "events.json").read_text("utf-8"))["events"]
    first_event = next(
        event for event in events if event["event_id"].endswith("galveston-hurricane:1900")
    )
    assert first_event["description"] == "Changed by the owner."
    assert second.publishable is False
    assert second.exit_code == 2


def test_pipeline_reports_natural_disasters_as_not_schedulable(tmp_path):
    data_dir = _copy_data(tmp_path)
    result = _run(tmp_path, data_dir)
    report = json.loads((result.bundle_dir / "quality_report.json").read_text("utf-8"))
    assert report["theme_metadata"]["Natural Disasters"]["schedulable"] is False
    assert report["upcoming_counts"]["Natural Disasters"]["365"] == 0


def test_pipeline_retires_events_from_a_removed_source_in_the_same_run(tmp_path):
    from astro_finance.events.bundle import write_dataset
    from conftest import build_event

    data_dir = _copy_data(tmp_path)
    previous = tmp_path / "previous"
    event = build_event(
        event_id="science:removed_source:gone-2027",
        source_id="removed_source",
        start_date=TODAY + timedelta(days=10),
    )
    write_dataset(previous, [event], today=TODAY)
    result = _run(tmp_path, data_dir, previous=previous, name="removed")
    payload = json.loads((result.bundle_dir / "events.json").read_text("utf-8"))
    retired = next(
        item for item in payload["events"] if item["event_id"] == event.event_id
    )
    assert retired["status"] == "unverified"
    assert retired["missing_runs"] == 2
    report = json.loads((result.bundle_dir / "quality_report.json").read_text("utf-8"))
    assert report["summary"]["events_retired"] == 1


def test_pipeline_writes_reject_reasons_and_fails_the_reject_rate_gate(tmp_path):
    data_dir = _copy_data(tmp_path)
    (data_dir / "curated" / "invalid.toml").write_text(
        "\n".join(
            [
                "[[events]]",
                'theme = "Finance"',
                'name = "Missing source url"',
                'date = "2027-01-15"',
                'verified_on = "2026-11-03"',
                'status = "scheduled"',
            ]
        ),
        encoding="utf-8",
    )
    result = _run(tmp_path, data_dir)
    rejects = json.loads((result.out_dir / "rejects.json").read_text("utf-8"))
    assert any(
        any("source_url" in reason for reason in item["reasons"])
        for item in rejects["rejects"]
    )
    assert result.publishable is False
    assert result.exit_code == 2
