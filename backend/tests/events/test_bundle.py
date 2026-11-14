from __future__ import annotations

import hashlib
import json
import shutil
import sqlite3
from datetime import date, timedelta
from pathlib import Path

import pandas as pd

from astro_finance.events.bundle import (
    CRYPTO_MILESTONES_FILENAME,
    MACRO_META_FILENAME,
    MACRO_PARQUET_FILENAME,
    PATTERNS_SKILL_FILENAME,
    bundle_version_for,
    finalize_bundle,
    sha256_file,
    validate_bundle_files,
    write_dataset,
)
from astro_finance.events.pipeline import PipelineOptions, run_pipeline
from astro_finance.events.reporting import quality_report_payload
from astro_finance.events.sqlite_writer import EVENT_COLUMNS
from conftest import FIXTURES, NOW, TODAY, build_event
from regime import patterns_v2

DATA = (
    Path(__file__).resolve().parents[2]
    / "data"
    / "processed"
    / "macro_regime_history.parquet"
)
MACRO_SIBLINGS = (
    MACRO_META_FILENAME,
    PATTERNS_SKILL_FILENAME,
    CRYPTO_MILESTONES_FILENAME,
)


def _macro_source(
    tmp_path: Path,
    *,
    with_meta: bool = True,
    with_skill: bool = True,
    data_version: str | None = None,
    latest_date: str = "2026-11-03",
    skill_fingerprint: str | None = None,
) -> Path:
    source = tmp_path / "macro"
    source.mkdir(parents=True)
    parquet = source / MACRO_PARQUET_FILENAME
    frame = pd.DataFrame(
        {
            "core_index": [1.0],
            "sp500_proxy": [100.0],
            "sp500_proxy_source": ["TEST"],
        },
        index=pd.DatetimeIndex(["2026-11-03"], tz="UTC"),
    )
    frame.to_parquet(parquet, engine="pyarrow", compression="snappy")
    version = data_version or hashlib.sha256(parquet.read_bytes()).hexdigest()[:12]
    if with_meta:
        (source / MACRO_META_FILENAME).write_text(
            json.dumps(
                {
                    "data_version": version,
                    "core_index": {"latest": {"date": latest_date}},
                }
            ),
            encoding="utf-8",
        )
    if with_skill:
        fingerprint = skill_fingerprint or patterns_v2.inputs_fingerprint(
            frame, "sp500"
        )
        (source / PATTERNS_SKILL_FILENAME).write_text(
            json.dumps(
                {
                    "schema_version": 2,
                    "inputs_fingerprint": {"sp500": fingerprint},
                }
            ),
            encoding="utf-8",
        )
    (source / CRYPTO_MILESTONES_FILENAME).write_text(
        json.dumps({"events": []}), encoding="utf-8"
    )
    return parquet


def _finalize(tmp_path: Path, artifact) -> dict:
    (tmp_path / "out").mkdir(exist_ok=True)
    report = quality_report_payload(
        events=[],
        source_runs={},
        gate_results=[],
        today=TODAY,
        bundle_version=artifact.bundle_version,
        summary={},
    )
    result = finalize_bundle(
        tmp_path / "out",
        artifact,
        events=[],
        source_specs={},
        source_runs={},
        gate_results=[],
        report=report,
        created_at=NOW,
        today=TODAY,
        execution_id="test",
        historical_source_sha256="missing",
    )
    return result.manifest


def _build(out: Path, *, created_at, today=TODAY):
    return run_pipeline(
        PipelineOptions(
            out_dir=out,
            today=today,
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


def test_write_dataset_copies_and_hashes_the_macro_siblings(tmp_path):
    parquet = _macro_source(tmp_path)
    artifact = write_dataset(
        tmp_path / "staging", [], today=TODAY, macro_parquet=parquet
    )

    for name in (MACRO_PARQUET_FILENAME, *MACRO_SIBLINGS):
        assert (artifact.staging_dir / "data" / name).is_file(), name
    hashes = {
        f"data/{name}": sha256_file(artifact.staging_dir / "data" / name)
        for name in (MACRO_PARQUET_FILENAME, *MACRO_SIBLINGS)
    }
    assert artifact.bundle_version == bundle_version_for([], hashes)
    assert artifact.warnings == ()

    manifest = _finalize(tmp_path, artifact)
    assert set(hashes) <= set(manifest["files"])
    for name, digest in hashes.items():
        assert manifest["files"][name] == digest
    assert validate_bundle_files(tmp_path / "out" / "bundle") == []


def test_bundle_carry_forward_keeps_all_three_macro_siblings(tmp_path):
    parquet = _macro_source(tmp_path)
    first = write_dataset(
        tmp_path / "first", [], today=TODAY, macro_parquet=parquet
    )
    carried = first.staging_dir / "data" / MACRO_PARQUET_FILENAME
    second = write_dataset(
        tmp_path / "second", [], today=TODAY, macro_parquet=carried
    )

    for name in (MACRO_PARQUET_FILENAME, *MACRO_SIBLINGS):
        assert (second.staging_dir / "data" / name).is_file(), name
    assert second.warnings == ()


def test_macro_bundle_warns_when_siblings_are_missing_or_stale(tmp_path):
    missing = _macro_source(
        tmp_path / "missing",
        with_meta=False,
        with_skill=False,
    )
    artifact = write_dataset(
        tmp_path / "missing-staging", [], today=TODAY, macro_parquet=missing
    )
    assert any(MACRO_META_FILENAME in warning for warning in artifact.warnings)
    assert any(PATTERNS_SKILL_FILENAME in warning for warning in artifact.warnings)

    stale = _macro_source(
        tmp_path / "stale",
        data_version="0" * 12,
        latest_date="2026-11-02",
    )
    stale_artifact = write_dataset(
        tmp_path / "stale-staging", [], today=TODAY, macro_parquet=stale
    )
    assert any("data_version" in warning for warning in stale_artifact.warnings)
    assert any("latest Core Index date" in warning for warning in stale_artifact.warnings)


def test_macro_bundle_warns_when_the_skill_fingerprint_does_not_match(tmp_path):
    stale = _macro_source(tmp_path, skill_fingerprint="0" * 16)
    artifact = write_dataset(
        tmp_path / "stale-skill-staging", [], today=TODAY, macro_parquet=stale
    )

    assert any(
        "inputs_fingerprint" in warning and "sp500" in warning
        for warning in artifact.warnings
    )


def test_quality_report_and_summary_carry_the_macro_sibling_warnings(tmp_path):
    carried = tmp_path / "carried.parquet"
    shutil.copyfile(DATA, carried)
    result = run_pipeline(
        PipelineOptions(
            out_dir=tmp_path / "out",
            today=date(2026, 11, 13),
            now=NOW,
            offline_dir=FIXTURES / "offline",
            macro_parquet=carried,
            macro_allow_unchanged_reason="test carries the baked artifact",
        )
    )

    report = json.loads(
        (result.bundle_dir / "quality_report.json").read_text("utf-8")
    )
    assert any(
        "WARNING:" in note and MACRO_META_FILENAME in note
        for note in report["notes"]
    )
    assert any(
        "WARNING:" in note and PATTERNS_SKILL_FILENAME in note
        for note in report["notes"]
    )
    assert all(gate["status"] == "pass" for gate in report["gates"])
    markdown = (result.bundle_dir / "quality_report.md").read_text("utf-8")
    assert "## Notes" in markdown and "WARNING:" in markdown


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
    result = _build(tmp_path / "out", created_at=NOW, today=date(2026, 11, 13))
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
    assert report["summary"]["events_total"] == 240
    assert report["summary"]["historical_total"] == 159
    assert report["summary"]["upcoming_total"] == 81
    assert all(gate["status"] == "pass" for gate in report["gates"])


def test_validate_bundle_reports_a_corrupted_file(tmp_path):
    result = _build(tmp_path / "out", created_at=NOW)
    events_path = result.bundle_dir / "events.json"
    events_path.write_text(events_path.read_text("utf-8").replace("Politics", "Xolitics"), "utf-8")
    errors = validate_bundle_files(result.bundle_dir)
    assert any("checksum mismatch" in error for error in errors)
