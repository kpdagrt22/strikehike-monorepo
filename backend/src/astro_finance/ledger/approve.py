"""Approve one roundup and append its ledger line in one checked step."""

from __future__ import annotations

import hashlib
import subprocess
from pathlib import Path
from typing import Any

from .store import (
    DEFAULT_LEDGER,
    REPO_ROOT,
    ROUNDUPS,
    LedgerError,
    append_entry,
    fetch_roundup,
    normalise_newlines,
    read_entries,
    verify_file,
)

APPROVED_FALSE = b'"approved": false'
APPROVED_TRUE = b'"approved": true'


def _git(repo_root: Path, *args: str) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(
            ["git", "-C", str(repo_root), *args],
            capture_output=True,
            text=True,
            check=False,
        )
    except OSError as exc:
        raise LedgerError("git is not available") from exc


def _relative(path: Path, root: Path) -> str:
    try:
        return str(path.resolve().relative_to(root.resolve())).replace("\\", "/")
    except ValueError as exc:
        raise LedgerError(f"{path} is outside {root}") from exc


def _require_clean_against_head(
    repo_root: Path, path: Path, label: str
) -> None:
    rel = _relative(path, repo_root)
    tracked = _git(repo_root, "ls-files", "--error-unmatch", "--", rel)
    if tracked.returncode != 0:
        raise LedgerError(f"{label} is not committed")
    diff = _git(repo_root, "diff", "--quiet", "HEAD", "--", rel)
    if diff.returncode != 0:
        raise LedgerError(f"{label} has uncommitted changes")


def _require_clean_ledger(repo_root: Path, ledger: Path) -> None:
    rel = _relative(ledger, repo_root)
    status = _git(repo_root, "status", "--porcelain", "--", rel)
    if status.returncode != 0:
        raise LedgerError("cannot read git status")
    if status.stdout.strip():
        raise LedgerError(f"{rel} has uncommitted changes")


def approve_roundup(
    week: str,
    *,
    repo_root: str | Path | None = None,
    roundups_dir: str | Path | None = None,
    ledger_path: str | Path | None = None,
) -> dict[str, Any]:
    """Flip one approval byte range, append the ledger, and verify it.

    The roundup file is restored if the append fails. Nothing is committed.
    """

    root = Path(repo_root or REPO_ROOT)
    roundups = Path(
        roundups_dir or root / "frontend" / "content" / "roundups"
    )
    ledger = Path(
        ledger_path
        or root / "frontend" / "content" / "ledger" / "ledger.jsonl"
    )
    path = roundups / f"{week}.json"
    if not path.exists():
        raise LedgerError(f"{week} is not approved")
    original = path.read_bytes()
    if original.count(APPROVED_TRUE) > 0:
        raise LedgerError(f"{week} is already approved")
    if original.count(APPROVED_FALSE) != 1:
        raise LedgerError(f"{week} has no single approved flag")

    _require_clean_against_head(root, path, f"{week} roundup")
    _require_clean_ledger(root, ledger)
    entries = read_entries(ledger)
    if any(entry.get("week") == week for entry in entries):
        raise LedgerError(f"{week} already has a ledger line")

    approved = original.replace(APPROVED_FALSE, APPROVED_TRUE, 1)
    path.write_bytes(approved)
    try:
        entry = append_entry(
            week,
            path=ledger,
            fetch=lambda name: fetch_roundup(name, roundups_dir=roundups),
        )
    except Exception:
        path.write_bytes(original)
        raise
    verify_file(ledger)
    return {
        "entry": entry,
        "sha256": hashlib.sha256(normalise_newlines(approved)).hexdigest(),
    }
