"""Build and verify the immutable events bundle.

The bundle is written into a staging directory first.  Events and SQLite are
always rebuilt from the canonical event list; nothing is patched in place.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Any, Iterable, Mapping

import pandas as pd

from .models import (
    THEME_METADATA,
    THEME_ORDER,
    Event,
    EventKind,
    EventStatus,
    SCHEMA_VERSION,
    SourceRun,
    canonical_json,
    iso_utc,
    sha256_hex,
    sort_events,
)
from .registry import SourceSpec
from .reporting import quality_report_markdown
from .sqlite_writer import write_sqlite

MACRO_PARQUET_FILENAME = "macro_regime_history.parquet"
MACRO_META_FILENAME = "macro_regime_history.meta.json"
PATTERNS_SKILL_FILENAME = "patterns_v2_skill.json"
CRYPTO_MILESTONES_FILENAME = "crypto_milestones.json"
MACRO_SIBLING_FILENAMES = (
    MACRO_META_FILENAME,
    PATTERNS_SKILL_FILENAME,
    CRYPTO_MILESTONES_FILENAME,
)


@dataclass(frozen=True, slots=True)
class DatasetArtifact:
    staging_dir: Path
    events_json: bytes
    sqlite_path: Path
    bundle_version: str
    canonical_events: tuple[dict[str, Any], ...]
    warnings: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class BundleResult:
    bundle_dir: Path
    bundle_version: str
    manifest: dict[str, Any]
    quality_report: dict[str, Any]
    publishable: bool


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def bundle_version_for(
    events: Iterable[Event],
    extra_hashes: Mapping[str, str] | None = None,
) -> str:
    payload: dict[str, Any] = {
        "events": [event.content_dict() for event in sort_events(events)]
    }
    if extra_hashes:
        payload["files"] = dict(sorted(extra_hashes.items()))
    return sha256_hex(canonical_json(payload))[:16]


def count_matrix(events: Iterable[Event]) -> dict[str, dict[str, dict[str, int]]]:
    matrix: dict[str, dict[str, dict[str, int]]] = {
        theme.value: {
            kind.value: {status.value: 0 for status in EventStatus}
            for kind in EventKind
        }
        for theme in THEME_ORDER
    }
    for event in events:
        matrix[event.theme.value][event.kind.value][event.status.value] += 1
    return matrix


def _write_json(path: Path, payload: Any, *, sort_keys: bool = False) -> bytes:
    text = json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=sort_keys)
    data = (text + "\n").encode("utf-8")
    path.write_bytes(data)
    return data


def _parquet_last_date(path: Path) -> str | None:
    """The last index date in a parquet, reading the index only."""

    try:
        frame = pd.read_parquet(path, columns=[])
    except (OSError, ValueError):
        return None
    index = pd.to_datetime(frame.index, utc=True, errors="coerce")
    index = index[~index.isna()]
    return index.max().date().isoformat() if len(index) else None


def macro_bundle_warnings(data_dir: Path) -> tuple[str, ...]:
    """Warnings for a bundled macro parquet whose siblings are missing or stale.

    These are quality-report warnings, never gate failures: the events bundle
    still publishes, while /regime and /patterns fall back to the baked files.
    """

    data_dir = Path(data_dir)
    parquet = data_dir / MACRO_PARQUET_FILENAME
    warnings: list[str] = []

    meta_path = data_dir / MACRO_META_FILENAME
    if not meta_path.is_file():
        warnings.append(
            f"WARNING: {MACRO_META_FILENAME} is missing from the bundle's data/"
            " directory; /regime will fall back to the baked meta."
        )
    else:
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            meta = None
        if not isinstance(meta, dict):
            warnings.append(
                f"WARNING: {MACRO_META_FILENAME} is not a readable JSON object;"
                " /regime will fall back to the baked meta."
            )
        else:
            expected_version = sha256_file(parquet)[:12] if parquet.is_file() else None
            data_version = meta.get("data_version")
            if expected_version is None or str(data_version) != expected_version:
                warnings.append(
                    f"WARNING: {MACRO_META_FILENAME} data_version "
                    f"{data_version!r} does not match the bundled parquet "
                    f"({expected_version!r})."
                )
            core_index = meta.get("core_index")
            latest = core_index.get("latest") if isinstance(core_index, dict) else None
            meta_date = latest.get("date") if isinstance(latest, dict) else None
            parquet_date = _parquet_last_date(parquet) if parquet.is_file() else None
            if meta_date != parquet_date:
                warnings.append(
                    f"WARNING: {MACRO_META_FILENAME} latest Core Index date "
                    f"{meta_date!r} does not match the bundled parquet's last "
                    f"date ({parquet_date!r})."
                )

    if not (data_dir / PATTERNS_SKILL_FILENAME).is_file():
        warnings.append(
            f"WARNING: {PATTERNS_SKILL_FILENAME} is missing from the bundle's"
            " data/ directory; /patterns will fall back to the baked skill."
        )
    return tuple(warnings)


def write_dataset(
    staging_dir: Path,
    events: list[Event],
    *,
    today: date,
    macro_parquet: Path | None = None,
    model_dir: Path | None = None,
) -> DatasetArtifact:
    """Write ``events.json``, SQLite and optional macro/model payloads."""

    del today  # reserved for future dataset-level metadata
    if staging_dir.exists():
        shutil.rmtree(staging_dir)
    staging_dir.mkdir(parents=True)
    ordered = sort_events(events)
    payload = {
        "schema_version": SCHEMA_VERSION,
        "events": [event.to_dict() for event in ordered],
    }
    events_json = _write_json(staging_dir / "events.json", payload)
    # SQLite is built from the serialized file, not from the in-memory list, so
    # the database and events.json cannot drift.
    serialized = json.loads(events_json.decode("utf-8"))
    sqlite_events = [Event.from_dict(item) for item in serialized["events"]]
    sqlite_path = staging_dir / "events.sqlite"
    write_sqlite(sqlite_path, sqlite_events)

    extra_hashes: dict[str, str] = {}
    warnings: tuple[str, ...] = ()
    if macro_parquet is not None:
        macro_source = Path(macro_parquet)
        target = staging_dir / "data" / MACRO_PARQUET_FILENAME
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(macro_source, target)
        extra_hashes[f"data/{MACRO_PARQUET_FILENAME}"] = sha256_file(target)
        # The ingestion flow writes these beside the parquet.  Copying them
        # here makes the existing previous-bundle carry-forward carry them too.
        for filename in MACRO_SIBLING_FILENAMES:
            sibling = macro_source.parent / filename
            if not sibling.is_file():
                continue
            destination = staging_dir / "data" / filename
            shutil.copyfile(sibling, destination)
            extra_hashes[f"data/{filename}"] = sha256_file(destination)
        warnings = macro_bundle_warnings(staging_dir / "data")
    if model_dir is not None:
        source = Path(model_dir)
        if (source / "models").is_dir():
            source = source / "models"
        target_root = staging_dir / "models"
        for path in sorted(source.rglob("*")):
            if not path.is_file():
                continue
            relative = path.relative_to(source)
            target = target_root / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(path, target)
            extra_hashes[f"models/{relative.as_posix()}"] = sha256_file(target)

    return DatasetArtifact(
        staging_dir=staging_dir,
        events_json=events_json,
        sqlite_path=sqlite_path,
        bundle_version=bundle_version_for(ordered, extra_hashes),
        canonical_events=tuple(event.content_dict() for event in ordered),
        warnings=warnings,
    )


def _source_manifest(
    source_specs: Mapping[str, SourceSpec],
    source_runs: Mapping[str, SourceRun],
) -> list[dict[str, Any]]:
    result = []
    for source_id, spec in source_specs.items():
        run = source_runs.get(source_id)
        result.append(
            {
                "id": source_id,
                "kind": spec.kind.value,
                "url": spec.url,
                "themes": [theme.value for theme in spec.themes],
                "reliability": spec.reliability.value,
                "verification": spec.verification.value,
                "expected_freshness_days": spec.expected_freshness_days,
                "record_count": run.record_count if run else 0,
                "rejected_count": run.rejected_count if run else 0,
                "fetched_this_run": run.fetched_this_run if run else False,
                "last_success_at": (
                    iso_utc(run.last_success_at)
                    if run and run.last_success_at
                    else None
                ),
                "error": run.error if run else None,
            }
        )
    return result


def current_git_sha() -> str:
    from_env = os.environ.get("GITHUB_SHA", "").strip()
    if from_env:
        return from_env
    repo_root = Path(__file__).resolve().parents[4]
    try:
        result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=repo_root,
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return "unknown"
    value = result.stdout.strip()
    return value if result.returncode == 0 and value else "unknown"


def finalize_bundle(
    out_dir: Path,
    artifact: DatasetArtifact,
    *,
    events: list[Event],
    source_specs: Mapping[str, SourceSpec],
    source_runs: Mapping[str, SourceRun],
    gate_results: list[Any],
    report: dict[str, Any],
    created_at: datetime,
    today: date,
    execution_id: str,
    historical_source_sha256: str,
    macro_data: Mapping[str, Any] | None = None,
    models: Mapping[str, Any] | None = None,
) -> BundleResult:
    staging = artifact.staging_dir
    _write_json(staging / "quality_report.json", report)
    (staging / "quality_report.md").write_text(
        quality_report_markdown(report), encoding="utf-8"
    )

    files = {
        path.relative_to(staging).as_posix(): sha256_file(path)
        for path in sorted(staging.rglob("*"))
        if path.is_file()
    }
    manifest = {
        "bundle_version": artifact.bundle_version,
        "schema_version": SCHEMA_VERSION,
        "created_at": iso_utc(created_at),
        "as_of": today.isoformat(),
        "git_sha": current_git_sha(),
        "sources": _source_manifest(source_specs, source_runs),
        "counts": count_matrix(events),
        "theme_metadata": {
            theme.value: dict(THEME_METADATA[theme]) for theme in THEME_ORDER
        },
        "files": files,
        "historical_source_sha256": historical_source_sha256,
        "publishable": report["publishable"],
    }
    if macro_data is not None:
        manifest["macro_data"] = dict(macro_data)
    if models is not None:
        manifest["models"] = dict(models)
    _write_json(staging / "manifest.json", manifest)

    final_dir = out_dir / "bundle"
    backup = out_dir / f".bundle-previous-{execution_id}"
    if backup.exists():
        shutil.rmtree(backup)
    if final_dir.exists():
        os.replace(final_dir, backup)
    try:
        os.replace(staging, final_dir)
    except OSError:
        if backup.exists() and not final_dir.exists():
            os.replace(backup, final_dir)
        raise
    if backup.exists():
        shutil.rmtree(backup)
    return BundleResult(
        bundle_dir=final_dir,
        bundle_version=artifact.bundle_version,
        manifest=manifest,
        quality_report=report,
        publishable=bool(report["publishable"]),
    )


def validate_bundle_files(bundle_dir: Path) -> list[str]:
    """Verify manifest checksums, canonical content and the SQLite schema."""

    errors: list[str] = []
    manifest_path = bundle_dir / "manifest.json"
    events_path = bundle_dir / "events.json"
    if not manifest_path.exists():
        return [f"missing {manifest_path}"]
    if not events_path.exists():
        return [f"missing {events_path}"]
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        payload = json.loads(events_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return [f"cannot read bundle JSON: {exc}"]

    for name, expected in manifest.get("files", {}).items():
        path = bundle_dir / name
        if not path.exists():
            errors.append(f"manifest lists missing file {name}")
        elif sha256_file(path) != expected:
            errors.append(f"checksum mismatch for {name}")

    events: list[Event] = []
    try:
        events = [Event.from_dict(item) for item in payload.get("events", [])]
    except (KeyError, TypeError, ValueError) as exc:
        errors.append(f"events.json contains an invalid event: {exc}")
    if events and bundle_version_for(events, {
        name: digest
        for name, digest in manifest.get("files", {}).items()
        if name.startswith("data/") or name.startswith("models/")
    }) != manifest.get("bundle_version"):
        errors.append("bundle_version does not match the canonical event content")

    sqlite_path = bundle_dir / "events.sqlite"
    if sqlite_path.exists():
        import sqlite3

        connection = sqlite3.connect(sqlite_path)
        try:
            version = connection.execute("PRAGMA user_version").fetchone()[0]
            count = connection.execute("SELECT COUNT(*) FROM events").fetchone()[0]
        except sqlite3.Error as exc:
            errors.append(f"SQLite check failed: {exc}")
        else:
            if version != SCHEMA_VERSION:
                errors.append(
                    f"SQLite user_version is {version}, expected {SCHEMA_VERSION}"
                )
            if count != len(events):
                errors.append(f"SQLite has {count} rows, events.json has {len(events)}")
        finally:
            connection.close()
    else:
        errors.append("missing events.sqlite")
    return errors
