"""Activation, rollback and status for versioned events bundles."""

from __future__ import annotations

import os
import re
import shutil
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .release import (
    ActivationError,
    expected_rows,
    fetch_assets,
    load_manifest,
    release_asset_names,
    safe_extract,
    verify_bundle_contents,
    verify_bundle_dir,
    verify_downloaded_assets,
)
from .store import (
    bundle_info,
    clear_bundle_cache,
    current_bundle_dir,
    event_counts,
    runtime_dir_from_env,
)

DEFAULT_REPO = "kpdagrt22/strikehike-monorepo"
VERSION_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
REPO_PATTERN = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
KEEP_BUNDLES = 3


@dataclass(frozen=True, slots=True)
class ActivationResult:
    version: str
    bundle_dir: Path
    previous_version: str | None
    pruned: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class RollbackResult:
    from_version: str | None
    to_version: str
    previous_version: str | None


def validate_version(version: str) -> str:
    value = str(version).strip()
    if not VERSION_PATTERN.match(value) or value in {".", ".."}:
        raise ActivationError(f"invalid bundle version: {version!r}")
    return value


def _pointer_text(version: str) -> str:
    # The tested Phase C format: runtime-relative, not an absolute host path.
    return f"bundles/{version}\n"


def _read_pointer(path: Path) -> str | None:
    try:
        text = path.read_text(encoding="utf-8").strip()
    except OSError:
        return None
    return text or None


def _version_from_pointer(text: str | None) -> str | None:
    if not text:
        return None
    return Path(text).name or None


def _atomic_write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    with temporary.open("w", encoding="utf-8", newline="\n") as handle:
        handle.write(text)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, path)
    try:
        directory_fd = os.open(str(path.parent), os.O_RDONLY)
    except OSError:
        return
    try:
        os.fsync(directory_fd)
    finally:
        os.close(directory_fd)


def _restore_pointer(runtime_dir: Path, previous_text: str | None) -> None:
    current = runtime_dir / "current"
    temporary = current.with_name(current.name + ".tmp")
    try:
        temporary.unlink()
    except OSError:
        pass
    if previous_text:
        _atomic_write(current, previous_text.rstrip("\n") + "\n")
    else:
        try:
            current.unlink()
        except OSError:
            pass
    clear_bundle_cache(runtime_dir)


def _resolve_pointer_text(runtime_dir: Path, text: str) -> Path | None:
    raw = Path(text)
    candidates = [
        raw if raw.is_absolute() else runtime_dir / raw,
        runtime_dir / "bundles" / text,
    ]
    for candidate in candidates:
        if (
            candidate.is_dir()
            and (candidate / "manifest.json").is_file()
            and (candidate / "events.sqlite").is_file()
        ):
            return candidate
    return None


def _self_check(runtime_dir: Path, bundle_dir: Path, manifest: dict[str, Any]) -> None:
    clear_bundle_cache(runtime_dir)
    resolved = current_bundle_dir(runtime_dir)
    if resolved is None or resolved.resolve() != bundle_dir.resolve():
        raise ActivationError("pointer self-check resolved a different bundle")
    info = bundle_info(bundle_dir)
    if info.get("bundle_version") != manifest.get("bundle_version"):
        raise ActivationError("pointer self-check saw a different bundle_version")
    counts = event_counts(bundle_dir / "events.sqlite")
    expected = expected_rows(manifest.get("counts"))
    if counts.get("total") != expected:
        raise ActivationError("pointer self-check row count does not match the manifest")
    if counts.get("by_theme_kind_status") != manifest.get("counts"):
        raise ActivationError("pointer self-check counts do not match the manifest")


def prune_bundles(runtime_dir: Path, *, active: Path | None = None) -> tuple[str, ...]:
    """Keep the three newest bundle directories (and always the active one)."""

    bundles_dir = runtime_dir / "bundles"
    if not bundles_dir.is_dir():
        return ()
    candidates = [
        path
        for path in bundles_dir.iterdir()
        if path.is_dir()
        and not path.name.startswith(".")
        and not path.name.endswith(".tmp")
    ]
    candidates.sort(
        key=lambda path: (path.stat().st_mtime_ns, path.name), reverse=True
    )
    keep = set(candidates[:KEEP_BUNDLES])
    if active is not None:
        keep.add(active)
    removed = []
    for path in candidates:
        if path in keep:
            continue
        try:
            shutil.rmtree(path)
        except OSError:
            continue
        removed.append(path.name)
    return tuple(removed)


def activate_bundle(
    *,
    version: str,
    repo: str = DEFAULT_REPO,
    runtime_dir: Path | None = None,
    release_dir: Path | None = None,
) -> ActivationResult:
    version = validate_version(version)
    if not REPO_PATTERN.match(repo):
        raise ActivationError(f"invalid repository: {repo!r}")
    runtime = Path(runtime_dir) if runtime_dir is not None else runtime_dir_from_env()
    runtime.mkdir(parents=True, exist_ok=True)
    bundles_dir = runtime / "bundles"
    bundles_dir.mkdir(parents=True, exist_ok=True)
    current = runtime / "current"

    previous_text = _read_pointer(current)
    previous_version = _version_from_pointer(previous_text)
    final_dir = bundles_dir / version
    if current_bundle_dir(runtime) == final_dir and final_dir.is_dir():
        try:
            verify_bundle_dir(final_dir, version)
        except ActivationError:
            pass
        else:
            expected_pointer = _pointer_text(version).strip()
            if previous_text != expected_pointer:
                _atomic_write(current, _pointer_text(version))
                clear_bundle_cache(runtime)
            return ActivationResult(version, final_dir, previous_version, ())

    workdir = Path(tempfile.mkdtemp(prefix=".activate-", dir=runtime))
    temporary = bundles_dir / f"{version}.tmp"
    backup = bundles_dir / f".{version}.bak-{os.getpid()}"
    pointer_swapped = False
    final_created = False
    try:
        files = fetch_assets(
            repo=repo,
            version=version,
            destination=workdir / "assets",
            release_dir=release_dir,
        )
        manifest = verify_downloaded_assets(files, version)
        tarball_name, manifest_name, _ = release_asset_names(version)
        if temporary.exists():
            shutil.rmtree(temporary)
        safe_extract(files[tarball_name], temporary)
        extracted_manifest = temporary / "manifest.json"
        if not extracted_manifest.is_file():
            raise ActivationError("release tarball has no manifest.json at its root")
        if extracted_manifest.read_bytes() != files[manifest_name].read_bytes():
            raise ActivationError("tarball manifest differs from the release manifest")
        verify_bundle_contents(temporary, manifest)

        if backup.exists():
            shutil.rmtree(backup)
        if final_dir.exists():
            os.replace(final_dir, backup)
        os.replace(temporary, final_dir)
        final_created = True

        _atomic_write(current, _pointer_text(version))
        pointer_swapped = True
        installed_manifest = verify_bundle_dir(final_dir, version)
        _self_check(runtime, final_dir, installed_manifest)

        if previous_text and previous_text.strip() != _pointer_text(version).strip():
            _atomic_write(runtime / "previous", previous_text.rstrip("\n") + "\n")
        elif previous_text is None:
            try:
                (runtime / "previous").unlink()
            except OSError:
                pass

        if backup.exists():
            shutil.rmtree(backup)
        pruned = prune_bundles(runtime, active=final_dir)
        return ActivationResult(version, final_dir, previous_version, pruned)
    except Exception as exc:
        if pointer_swapped:
            _restore_pointer(runtime, previous_text)
        if final_created and final_dir.exists():
            shutil.rmtree(final_dir, ignore_errors=True)
        if backup.exists():
            try:
                os.replace(backup, final_dir)
            except OSError:
                pass
        shutil.rmtree(temporary, ignore_errors=True)
        clear_bundle_cache(runtime)
        if isinstance(exc, ActivationError):
            raise
        raise ActivationError(f"activation failed: {exc}") from exc
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


def rollback_bundle(runtime_dir: Path | None = None) -> RollbackResult:
    runtime = Path(runtime_dir) if runtime_dir is not None else runtime_dir_from_env()
    previous_text = _read_pointer(runtime / "previous")
    if not previous_text:
        raise ActivationError("no previous bundle is recorded")
    target = _resolve_pointer_text(runtime, previous_text)
    if target is None:
        raise ActivationError(f"previous bundle is missing: {previous_text}")
    manifest = verify_bundle_dir(target)
    current_text = _read_pointer(runtime / "current")
    target_version = str(manifest["bundle_version"])
    if target.name != target_version:
        raise ActivationError("previous bundle directory does not match its version")
    target_pointer = _pointer_text(target_version)
    try:
        _atomic_write(runtime / "current", target_pointer)
        _self_check(runtime, target, manifest)
        if current_text:
            _atomic_write(runtime / "previous", current_text.rstrip("\n") + "\n")
        else:
            try:
                (runtime / "previous").unlink()
            except OSError:
                pass
    except Exception:
        _restore_pointer(runtime, current_text)
        raise
    return RollbackResult(
        from_version=_version_from_pointer(current_text),
        to_version=target_version,
        previous_version=_version_from_pointer(current_text),
    )


def activation_status(runtime_dir: Path | None = None) -> dict[str, Any]:
    runtime = Path(runtime_dir) if runtime_dir is not None else runtime_dir_from_env()
    current_text = _read_pointer(runtime / "current")
    previous_text = _read_pointer(runtime / "previous")
    active = current_bundle_dir(runtime)
    current_version = _version_from_pointer(current_text)
    previous_version = _version_from_pointer(previous_text)
    bundles: list[dict[str, Any]] = []
    bundles_dir = runtime / "bundles"
    if bundles_dir.is_dir():
        for path in sorted(bundles_dir.iterdir(), key=lambda item: item.name):
            if (
                not path.is_dir()
                or path.name.startswith(".")
                or path.name.endswith(".tmp")
            ):
                continue
            entry: dict[str, Any] = {
                "version": path.name,
                "active": bool(active and path.resolve() == active.resolve()),
                "previous": path.name == previous_version,
            }
            try:
                manifest = load_manifest(path)
            except ActivationError as exc:
                entry["error"] = str(exc)
            else:
                entry["created_at"] = manifest.get("created_at")
                entry["bundle_version"] = manifest.get("bundle_version")
                entry["publishable"] = manifest.get("publishable")
            bundles.append(entry)
    return {
        "runtime_dir": str(runtime),
        "active_version": current_version if active else None,
        "active_bundle": str(active) if active else None,
        "pointer": current_text,
        "previous_version": previous_version,
        "bundles": bundles,
    }
