from __future__ import annotations

import json
import sqlite3
from datetime import timedelta
from pathlib import Path

from astro_finance.events.bundle import (
    bundle_version_for,
    validate_bundle_files,
    write_dataset,
)
from astro_finance.events.pipeline import PipelineOptions, run_pipeline
from astro_finance.events.sqlite_writer import EVENT_COLUMNS
from conftest import FIXTURES, NOW, TODAY, build_event


def _build(out: Path, *, created_at):
    return run_pipeline(
        PipelineOptions(
            out_dir=out,
            today=TODAY,
            now=NOW,
            offline_dir=FIXTURES / "offline",
            created_at=created_at,
        )
    )


def test_write_dataset_is_fresh_and_canonical(tmp_path):
    later = build_event(event_id="science:test:later", start_date=TODAY + timedelta(days=2))
    earlier = build_event(event_id="science:test:earlier", start_date=TODAY + timedelta(days=1))
    artifact = write_dataset(tmp_path / "staging", [later, earlier], today=TODAY)
    payload = json.loads(artifact.events_json.decode("utf-8"))
    assert [event["event_id"] for event in payload["events"]] == [
        "science:test:earlier",
        "science:test:later",
    ]
    assert list(payload["events"][0])[:4] == ["event_id", "name", "theme", "kind"]
    assert artifact.bundle_version == bundle_version_for([earlier, later])

    connection = sqlite3.connect(artifact.sqlite_path)
    try:
        assert connection.execute("PRAGMA user_version").fetchone()[0] == 1
        columns = [row[1] for row in connection.execute("PRAGMA table_info(events)")]
        assert columns == list(EVENT_COLUMNS)
        indexes = {row[1] for row in connection.execute("PRAGMA index_list(events)")}
        assert "idx_events_kind_theme_status_date" in indexes
        assert "idx_events_event_id" in indexes
        assert connection.execute("SELECT COUNT(*) FROM events").fetchone()[0] == 2
    finally:
        connection.close()


def test_build_is_idempotent_apart_from_created_at(tmp_path):
    first = _build(tmp_path / "first", created_at=NOW)
    second = _build(tmp_path / "second", created_at=NOW + timedelta(hours=1))
    assert first.bundle_version == second.bundle_version
    assert not first.publishable and not second.publishable
    assert first.quality_report["test_build"] is True
    assert (first.bundle_dir / "quality_report.md").read_text("utf-8").startswith(
        "TEST BUILD (offline fixtures), never publishable\n\n"
    )

    for name in ("events.json", "events.sqlite", "quality_report.json", "quality_report.md"):
        assert (first.bundle_dir / name).read_bytes() == (
            second.bundle_dir / name
        ).read_bytes(), name

    first_manifest = json.loads((first.bundle_dir / "manifest.json").read_text("utf-8"))
    second_manifest = json.loads((second.bundle_dir / "manifest.json").read_text("utf-8"))
    assert first_manifest.pop("created_at") != second_manifest.pop("created_at")
    assert first_manifest == second_manifest


def test_manifest_has_the_documented_keys_and_counts(tmp_path):
    result = _build(tmp_path / "out", created_at=NOW)
    manifest = json.loads((result.bundle_dir / "manifest.json").read_text("utf-8"))
    assert set(manifest) == {
        "bundle_version",
        "schema_version",
        "created_at",
        "as_of",
        "git_sha",
        "sources",
        "counts",
        "theme_metadata",
        "files",
        "historical_source_sha256",
        "publishable",
    }
    assert len(manifest["bundle_version"]) == 16
    assert len(manifest["sources"]) == 5
    assert manifest["theme_metadata"]["Natural Disasters"]["schedulable"] is False
    assert manifest["counts"]["Science"]["historical"]["completed"] == 43
    assert manifest["counts"]["Politics"]["historical"]["completed"] == 46
    assert manifest["publishable"] is False
    assert set(manifest["files"]) == {
        "events.json",
        "events.sqlite",
        "quality_report.json",
        "quality_report.md",
    }
    assert validate_bundle_files(result.bundle_dir) == []


def test_bundle_version_is_a_short_sha_of_the_content(tmp_path):
    result = _build(tmp_path / "out", created_at=NOW)
    assert result.bundle_version == result.manifest["bundle_version"]
    assert len(result.bundle_version) == 16
    int(result.bundle_version, 16)


def test_quality_report_has_counts_for_every_theme(tmp_path):
    result = _build(tmp_path / "out", created_at=NOW)
    report = json.loads((result.bundle_dir / "quality_report.json").read_text("utf-8"))
    assert report["test_build"] is True
    assert report["publishable"] is False
    markdown = (result.bundle_dir / "quality_report.md").read_text("utf-8")
    assert markdown.startswith("TEST BUILD (offline fixtures), never publishable\n\n")
    assert set(report["upcoming_counts"]) == {
        "Politics",
        "Science",
        "Finance",
        "Culture/Religion",
        "Natural Disasters",
    }
    for theme in report["upcoming_counts"].values():
        assert set(theme) == {"30", "90", "365"}
    assert report["summary"]["events_total"] == 232
    assert report["summary"]["historical_total"] == 159
    assert report["summary"]["upcoming_total"] == 73
    assert all(gate["status"] == "pass" for gate in report["gates"])


def test_validate_bundle_reports_a_corrupted_file(tmp_path):
    result = _build(tmp_path / "out", created_at=NOW)
    events_path = result.bundle_dir / "events.json"
    events_path.write_text(events_path.read_text("utf-8").replace("Politics", "Xolitics"), "utf-8")
    errors = validate_bundle_files(result.bundle_dir)
    assert any("checksum mismatch" in error for error in errors)
