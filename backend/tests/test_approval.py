from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
from pathlib import Path

import pytest

from astro_finance.ledger.approve import approve_roundup
from astro_finance.ledger.store import (
    LedgerError,
    append_entry,
    normalise_newlines,
    read_entries,
    verify_file,
)

REAL_LEDGER = (
    Path(__file__).resolve().parents[2]
    / "frontend"
    / "content"
    / "ledger"
    / "ledger.jsonl"
)


def _git(root: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", "-C", str(root), *args],
        check=True,
        capture_output=True,
        text=True,
    )


def _write_roundup(root: Path, week: str, *, approved: bool) -> Path:
    path = root / "frontend" / "content" / "roundups" / f"{week}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "schema": 2,
        "week": week,
        "start": "2026-11-23",
        "end": "2026-11-29",
        "generated_at": "2026-11-21T04:30:00.000Z",
        "approved": approved,
        "regime": {
            "as_of": "2026-11-08",
            "score": 13.18,
            "label": "Steady",
            "previous_score": 14.9,
            "change": -1.7,
        },
        "lines": {
            "regime": "Core Index +13.2 (Steady), −1.7 from the week before."
        },
    }
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return path


def _setup(
    tmp_path: Path, *, approved: bool = False
) -> tuple[Path, Path, Path]:
    root = tmp_path / "repo"
    root.mkdir()
    ledger = root / "frontend" / "content" / "ledger" / "ledger.jsonl"
    ledger.parent.mkdir(parents=True)
    shutil.copyfile(REAL_LEDGER, ledger)
    roundup = _write_roundup(root, "2026-W48", approved=approved)
    _git(root, "init")
    _git(root, "config", "user.email", "test@example.com")
    _git(root, "config", "user.name", "Test")
    _git(root, "add", ".")
    _git(root, "commit", "-m", "fixture")
    return root, roundup, ledger


def test_approve_flips_one_range_appends_and_verifies(tmp_path):
    root, roundup, ledger = _setup(tmp_path)
    original = roundup.read_bytes()
    before = read_entries(ledger)

    result = approve_roundup("2026-W48", repo_root=root)

    approved = roundup.read_bytes()
    assert approved == original.replace(
        b'"approved": false', b'"approved": true', 1
    )
    assert result["sha256"] == hashlib.sha256(
        normalise_newlines(approved)
    ).hexdigest()
    entries = read_entries(ledger)
    assert len(entries) == len(before) + 1
    entry = entries[-1]
    assert entry["week"] == "2026-W48"
    assert entry["roundup_sha256"] == result["sha256"]
    assert verify_file(ledger) == entries

    with pytest.raises(LedgerError, match="already approved"):
        approve_roundup("2026-W48", repo_root=root)


def test_approve_refuses_an_already_approved_week(tmp_path):
    root, _, _ = _setup(tmp_path, approved=True)
    with pytest.raises(LedgerError, match="already approved"):
        approve_roundup("2026-W48", repo_root=root)


def test_approve_refuses_other_roundup_changes(tmp_path):
    root, roundup, _ = _setup(tmp_path)
    roundup.write_bytes(
        roundup.read_bytes().replace(b'"schema": 2', b'"schema": 3', 1)
    )
    with pytest.raises(LedgerError, match="roundup has uncommitted changes"):
        approve_roundup("2026-W48", repo_root=root)


def test_approve_refuses_an_uncommitted_ledger(tmp_path):
    root, _, ledger = _setup(tmp_path)
    ledger.write_text(ledger.read_text(encoding="utf-8") + "\n", encoding="utf-8")
    with pytest.raises(
        LedgerError, match="ledger.jsonl has uncommitted changes"
    ):
        approve_roundup("2026-W48", repo_root=root)


def test_approve_refuses_a_week_that_already_has_a_ledger_line(tmp_path):
    root, roundup, ledger = _setup(tmp_path)

    def fake(week: str):
        data = json.loads(roundup.read_text(encoding="utf-8"))
        data["approved"] = True
        raw = json.dumps(data, indent=2).encode("utf-8") + b"\n"
        return data, normalise_newlines(raw)

    append_entry("2026-W48", path=ledger, fetch=fake)
    _git(root, "add", ".")
    _git(root, "commit", "-m", "existing line")

    with pytest.raises(LedgerError, match="already has a ledger line"):
        approve_roundup("2026-W48", repo_root=root)


def test_approve_refuses_an_uncommitted_new_roundup(tmp_path):
    root, _, _ = _setup(tmp_path)
    _write_roundup(root, "2026-W49", approved=False)
    with pytest.raises(LedgerError, match="roundup is not committed"):
        approve_roundup("2026-W49", repo_root=root)


def test_approve_refuses_a_missing_week(tmp_path):
    root, _, _ = _setup(tmp_path)
    with pytest.raises(LedgerError, match="2026-W50 is not approved"):
        approve_roundup("2026-W50", repo_root=root)
