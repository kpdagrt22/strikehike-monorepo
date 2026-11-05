"""Release asset download, checksum verification and safe extraction."""

from __future__ import annotations

import hashlib
import json
import logging
import shutil
import sqlite3
import tarfile
import time
from pathlib import Path, PurePosixPath
from typing import Any

import requests

MAX_ASSET_BYTES = 100 * 1024 * 1024
MAX_TAR_MEMBERS = 500
MAX_TAR_BYTES = 250 * 1024 * 1024
TIMEOUT_SECONDS = 30
# The initial request plus three retries. The delays apply after attempts 1-3.
RETRY_DELAYS_SECONDS = (5, 15, 30)
MAX_DOWNLOAD_ATTEMPTS = len(RETRY_DELAYS_SECONDS) + 1

logger = logging.getLogger(__name__)


class ActivationError(RuntimeError):
    """Activation cannot continue; the caller restores the previous pointer."""


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def release_asset_names(version: str) -> tuple[str, str, str]:
    return (
        f"events-bundle-{version}.tar.gz",
        "manifest.json",
        "SHA256SUMS",
    )


def _safe_relative(name: str) -> PurePosixPath:
    pure = PurePosixPath(name)
    if pure.is_absolute() or ".." in pure.parts or "\\" in name or not name:
        raise ActivationError(f"unsafe relative path in bundle: {name!r}")
    return pure


def _retryable_status(status: int) -> bool:
    return status == 429 or 500 <= status <= 599


def _write_response(response: requests.Response, destination: Path) -> None:
    written = 0
    with destination.open("wb") as handle:
        for chunk in response.iter_content(chunk_size=1024 * 1024):
            if not chunk:
                continue
            written += len(chunk)
            if written > MAX_ASSET_BYTES:
                raise ActivationError("release asset exceeds the size limit")
            handle.write(chunk)


def _download(url: str, destination: Path) -> None:
    """Download one asset, retrying transient failures.

    HTTP 5xx, 429, connection errors and timeouts get three retries with
    backoff. Every other HTTP 4xx fails at once. The destination is truncated
    on each successful response, so a partial attempt can never be mistaken
    for the final asset; the caller verifies checksums after this returns.
    """
    for attempt in range(1, MAX_DOWNLOAD_ATTEMPTS + 1):
        retry_reason = None
        last_status = None
        last_exception = None
        try:
            with requests.get(url, stream=True, timeout=TIMEOUT_SECONDS) as response:
                status = response.status_code
                if status == 200:
                    _write_response(response, destination)
                    return
                if not _retryable_status(status):
                    raise ActivationError(
                        f"release asset download returned HTTP {status}"
                    )
                last_status = status
                retry_reason = f"HTTP {status}"
        except requests.RequestException as exc:
            retryable = isinstance(
                exc,
                (
                    requests.ConnectionError,
                    requests.Timeout,
                    requests.exceptions.ChunkedEncodingError,
                ),
            )
            if not retryable:
                raise ActivationError(
                    f"release asset download failed: {type(exc).__name__}"
                ) from exc
            last_exception = exc
            retry_reason = type(exc).__name__

        if attempt == MAX_DOWNLOAD_ATTEMPTS:
            if last_exception is not None:
                raise ActivationError(
                    "release asset download failed after "
                    f"{MAX_DOWNLOAD_ATTEMPTS} attempts: "
                    f"{type(last_exception).__name__}"
                ) from last_exception
            raise ActivationError(
                "release asset download returned HTTP "
                f"{last_status} after {MAX_DOWNLOAD_ATTEMPTS} attempts"
            )

        delay = RETRY_DELAYS_SECONDS[attempt - 1]
        logger.warning(
            "release asset %s attempt %d/%d failed (%s); retrying in %ds",
            destination.name,
            attempt,
            MAX_DOWNLOAD_ATTEMPTS,
            retry_reason,
            delay,
        )
        time.sleep(delay)


def fetch_assets(
    *,
    repo: str,
    version: str,
    destination: Path,
    release_dir: Path | None = None,
) -> dict[str, Path]:
    destination.mkdir(parents=True, exist_ok=True)
    tarball, manifest, sums = release_asset_names(version)
    paths: dict[str, Path] = {}
    for name in (tarball, manifest, sums):
        target = destination / name
        if release_dir is not None:
            source = release_dir / name
            if not source.is_file():
                raise ActivationError(f"release fixture missing: {name}")
            shutil.copyfile(source, target)
        else:
            url = (
                f"https://github.com/{repo}/releases/download/"
                f"events-bundle-{version}/{name}"
            )
            _download(url, target)
        paths[name] = target
    return paths


def parse_sha256sums(path: Path) -> dict[str, str]:
    sums: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        parts = line.split(maxsplit=1)
        if len(parts) != 2:
            raise ActivationError("SHA256SUMS has a malformed line")
        digest, name = parts[0].lower(), parts[1].lstrip("*").strip()
        if len(digest) != 64 or any(char not in "0123456789abcdef" for char in digest):
            raise ActivationError("SHA256SUMS has a malformed digest")
        if not name or "/" in name or "\\" in name:
            raise ActivationError("SHA256SUMS has an unsafe file name")
        sums[name] = digest
    return sums


def verify_downloaded_assets(
    paths: dict[str, Path], version: str
) -> dict[str, Any]:
    tarball_name, manifest_name, sums_name = release_asset_names(version)
    for name in (tarball_name, manifest_name, sums_name):
        if name not in paths or not paths[name].is_file():
            raise ActivationError(f"missing release asset: {name}")
    sums = parse_sha256sums(paths[sums_name])
    for name in (tarball_name, manifest_name):
        expected = sums.get(name)
        if expected is None:
            raise ActivationError(f"SHA256SUMS does not list {name}")
        if sha256_file(paths[name]) != expected:
            raise ActivationError(f"checksum mismatch for {name}")
    try:
        manifest = json.loads(paths[manifest_name].read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ActivationError(f"manifest.json is invalid: {exc}") from exc
    if not isinstance(manifest, dict):
        raise ActivationError("manifest.json is not an object")
    if manifest.get("bundle_version") != version:
        raise ActivationError("manifest bundle_version does not match the release")
    if manifest.get("publishable") is not True:
        raise ActivationError("refusing to activate a non-publishable bundle")
    return manifest


def safe_extract(tarball: Path, destination: Path) -> None:
    """Extract only regular files/directories, inside ``destination``."""

    destination.mkdir(parents=True, exist_ok=True)
    root = destination.resolve()
    try:
        with tarfile.open(tarball, "r:gz") as archive:
            members = archive.getmembers()
            if len(members) > MAX_TAR_MEMBERS:
                raise ActivationError("release tarball has too many members")
            total = 0
            safe_members = []
            for member in members:
                pure = _safe_relative(member.name)
                if not (member.isfile() or member.isdir()):
                    raise ActivationError(
                        f"release tarball contains a non-file member: {member.name!r}"
                    )
                target = (destination / pure).resolve()
                if not target.is_relative_to(root):
                    raise ActivationError(
                        f"release tarball escapes its destination: {member.name!r}"
                    )
                total += max(0, int(member.size))
                if total > MAX_TAR_BYTES:
                    raise ActivationError("release tarball exceeds the size limit")
                safe_members.append(member)
            archive.extractall(destination, members=safe_members)
    except (OSError, tarfile.TarError) as exc:
        raise ActivationError(f"release tarball cannot be extracted: {exc}") from exc


def expected_rows(counts: Any) -> int:
    if not isinstance(counts, dict):
        raise ActivationError("manifest counts are not an object")
    total = 0
    for kinds in counts.values():
        if not isinstance(kinds, dict):
            raise ActivationError("manifest counts have an invalid shape")
        for statuses in kinds.values():
            if not isinstance(statuses, dict):
                raise ActivationError("manifest counts have an invalid shape")
            for value in statuses.values():
                if not isinstance(value, int) or value < 0:
                    raise ActivationError("manifest counts have an invalid value")
                total += value
    return total


def verify_bundle_contents(
    bundle_dir: Path, manifest: dict[str, Any]
) -> None:
    """Verify every manifest file hash, the event count and SQLite."""

    if manifest.get("publishable") is not True:
        raise ActivationError("refusing to activate a non-publishable bundle")
    schema_version = int(manifest.get("schema_version", -1))
    files = manifest.get("files")
    if not isinstance(files, dict):
        raise ActivationError("manifest files are missing")
    for required in ("events.json", "events.sqlite"):
        if required not in files:
            raise ActivationError(f"manifest does not list {required}")
    for name, expected in files.items():
        if not isinstance(name, str) or not isinstance(expected, str):
            raise ActivationError("manifest files contain an invalid entry")
        _safe_relative(name)
        path = bundle_dir / name
        if not path.is_file():
            raise ActivationError(f"bundle file is missing: {name}")
        if sha256_file(path) != expected.lower():
            raise ActivationError(f"bundle checksum mismatch: {name}")

    expected_count = expected_rows(manifest.get("counts"))
    try:
        events_payload = json.loads(
            (bundle_dir / "events.json").read_text(encoding="utf-8")
        )
        event_count = len(events_payload.get("events", []))
    except (OSError, json.JSONDecodeError, AttributeError) as exc:
        raise ActivationError(f"events.json is invalid: {exc}") from exc
    if event_count != expected_count:
        raise ActivationError(
            f"events.json has {event_count} events, manifest counts say {expected_count}"
        )

    database = bundle_dir / "events.sqlite"
    try:
        connection = sqlite3.connect(database.resolve().as_uri() + "?mode=ro", uri=True)
    except sqlite3.Error as exc:
        raise ActivationError(f"events.sqlite cannot be opened: {exc}") from exc
    try:
        integrity = [
            row[0] for row in connection.execute("PRAGMA integrity_check").fetchall()
        ]
        if integrity != ["ok"]:
            raise ActivationError("events.sqlite failed PRAGMA integrity_check")
        user_version = int(
            connection.execute("PRAGMA user_version").fetchone()[0]
        )
        if user_version != schema_version:
            raise ActivationError(
                f"events.sqlite user_version is {user_version}, expected {schema_version}"
            )
        row_count = int(
            connection.execute("SELECT COUNT(*) FROM events").fetchone()[0]
        )
        if row_count != expected_count:
            raise ActivationError(
                f"events.sqlite has {row_count} rows, manifest says {expected_count}"
            )
    except sqlite3.Error as exc:
        raise ActivationError(f"events.sqlite check failed: {exc}") from exc
    finally:
        connection.close()


def load_manifest(bundle_dir: Path) -> dict[str, Any]:
    path = bundle_dir / "manifest.json"
    if not path.is_file():
        raise ActivationError(f"bundle has no manifest: {bundle_dir}")
    try:
        manifest = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ActivationError(f"bundle manifest is invalid: {exc}") from exc
    if not isinstance(manifest, dict):
        raise ActivationError("bundle manifest is not an object")
    return manifest


def verify_bundle_dir(bundle_dir: Path, expected_version: str | None = None) -> dict[str, Any]:
    manifest = load_manifest(bundle_dir)
    if expected_version is not None and manifest.get("bundle_version") != expected_version:
        raise ActivationError("manifest bundle_version does not match the request")
    verify_bundle_contents(bundle_dir, manifest)
    return manifest
