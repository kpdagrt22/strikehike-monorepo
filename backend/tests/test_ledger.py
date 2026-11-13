from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
from pathlib import Path

import pytest

from astro_finance.ledger.canonical import CanonicalError, canonical_json, ledger_hash
from astro_finance.ledger.store import (
    REPO_ROOT,
    ROUNDUPS,
    LedgerError,
    append_entry,
    fetch_roundup,
    format_core_index,
    latest_for_week,
    normalise_newlines,
    read_entries,
    verify_file,
)

VECTOR = REPO_ROOT / "tests" / "fixtures" / "ledger" / "vector.json"
REAL_LEDGER = REPO_ROOT / "frontend" / "content" / "ledger" / "ledger.jsonl"
NODE_SCRIPT = REPO_ROOT / "frontend" / "scripts" / "ledger-verify.mjs"
BROWSER_SCRIPT = REPO_ROOT / "frontend" / "scripts" / "ledger-browser-verify.mjs"

ROUNDUP = {
    "week": "2026-W46",
    "approved": True,
    "regime": {
        "as_of": "2026-10-27",
        "score": 15.76,
        "label": "Steady",
    },
}
RAW = json.dumps(ROUNDUP, separators=(",", ":")).encode("utf-8")


def fake_fetch(week: str):
    if week != "2026-W46":
        raise LedgerError(f"{week} is not approved")
    return ROUNDUP, RAW


def test_shared_vector_matches_python_canonical_bytes_and_hash():
    data = json.loads(VECTOR.read_text(encoding="utf-8"))
    for vector in data["vectors"]:
        entry = vector["entry"]
        payload = {key: value for key, value in entry.items() if key != "hash"}
        assert canonical_json(payload) == vector["canonical"]
        assert ledger_hash(entry) == vector["hash"]
    for case in data["rounding"]:
        assert format_core_index(case["input"]) == case["stored"]


def test_whole_number_readings_are_strings_and_both_twins_verify(tmp_path):
    node = shutil.which("node")
    if not node:
        pytest.skip("node is not installed")
    scores = [15.76, 16.0, -3.0, 0.0, -0.0, 12.35]
    weeks = [f"2026-W{46 + index}" for index in range(len(scores))]

    def fake(week: str):
        score = scores[weeks.index(week)]
        return (
            {
                "week": week,
                "approved": True,
                "regime": {
                    "as_of": "2026-10-27",
                    "score": score,
                    "label": "Steady",
                },
            },
            b"{}",
        )

    path = tmp_path / "whole-numbers.jsonl"
    for week in weeks:
        append_entry(week, path=path, fetch=fake)

    entries = verify_file(path)
    assert [entry["reading"]["core_index"] for entry in entries] == [
        "15.8",
        "16.0",
        "-3.0",
        "0.0",
        "-0.0",
        "12.4",
    ]

    subprocess.run(
        [node, str(NODE_SCRIPT), "--path", str(path)],
        cwd=REPO_ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    subprocess.run(
        [
            node,
            "--experimental-strip-types",
            str(BROWSER_SCRIPT),
            "--path",
            str(path),
        ],
        cwd=REPO_ROOT,
        check=True,
        capture_output=True,
        text=True,
    )


def test_crlf_roundup_hashes_like_lf(tmp_path):
    source = ROUNDUPS / "2026-W46.json"
    lf = normalise_newlines(source.read_bytes())
    crlf = lf.replace(b"\n", b"\r\n")
    for name, raw in (("lf", lf), ("crlf", crlf)):
        directory = tmp_path / name
        directory.mkdir()
        (directory / "2026-W46.json").write_bytes(raw)

    _, lf_raw = fetch_roundup("2026-W46", roundups_dir=tmp_path / "lf")
    _, crlf_raw = fetch_roundup("2026-W46", roundups_dir=tmp_path / "crlf")
    assert lf_raw == crlf_raw
    assert hashlib.sha256(lf_raw).hexdigest() == hashlib.sha256(crlf_raw).hexdigest()


def test_genesis_roundup_hash_matches_committed_file():
    entries = verify_file(REAL_LEDGER)
    expected = hashlib.sha256(
        normalise_newlines((ROUNDUPS / "2026-W46.json").read_bytes())
    ).hexdigest()
    assert entries[0]["roundup_sha256"] == expected
    assert entries[0]["reading"]["core_index"] == "15.8"


def test_canonical_rejects_non_integer_numbers():
    with pytest.raises(CanonicalError, match="non-integer"):
        canonical_json({"core_index": 16.5})


def test_append_dry_run_writes_nothing(tmp_path):
    path = tmp_path / "ledger.jsonl"
    entry = append_entry("2026-W46", path=path, dry_run=True, fetch=fake_fetch)
    assert entry["seq"] == 1
    assert entry["kind"] == "roundup"
    assert entry["reading"]["core_index"] == "15.8"
    assert isinstance(entry["reading"]["core_index"], str)
    assert not path.exists()


def test_append_refuses_duplicate_and_unapproved_week(tmp_path):
    path = tmp_path / "ledger.jsonl"
    append_entry("2026-W46", path=path, fetch=fake_fetch)
    with pytest.raises(LedgerError, match="already"):
        append_entry("2026-W46", path=path, fetch=fake_fetch)
    with pytest.raises(LedgerError, match="not approved"):
        append_entry("2026-W47", path=path, fetch=fake_fetch)


def test_append_refuses_a_broken_chain(tmp_path):
    path = tmp_path / "ledger.jsonl"
    append_entry("2026-W46", path=path, fetch=fake_fetch)
    entry = json.loads(path.read_text(encoding="utf-8"))
    entry["reading"]["core_index"] = "99.9"
    path.write_text(json.dumps(entry) + "\n", encoding="utf-8")
    with pytest.raises(LedgerError, match="hash does not match"):
        append_entry("2026-W46", path=path, fetch=fake_fetch)


def test_correction_is_a_new_line_and_links_to_the_old_one(tmp_path):
    path = tmp_path / "ledger.jsonl"
    first = append_entry("2026-W46", path=path, fetch=fake_fetch)
    correction = append_entry(
        "2026-W46",
        path=path,
        correction_of=1,
        reason="The label was corrected after a typo.",
        fetch=fake_fetch,
    )
    assert correction["seq"] == 2
    assert correction["kind"] == "correction"
    assert correction["corrects_seq"] == 1
    assert correction["prev_hash"] == first["hash"]
    entries = verify_file(path)
    assert len(entries) == 2
    assert entries[0]["hash"] == first["hash"]


def test_tampering_a_field_fails_at_that_seq(tmp_path):
    path = tmp_path / "ledger.jsonl"
    append_entry("2026-W46", path=path, fetch=fake_fetch)
    entry = json.loads(path.read_text(encoding="utf-8"))
    entry["reading"]["label"] = "Changed"
    path.write_text(json.dumps(entry) + "\n", encoding="utf-8")
    with pytest.raises(LedgerError, match="seq 1: hash does not match"):
        verify_file(path)


def test_the_real_ledger_verifies_and_starts_at_2026_W46():
    entries = verify_file(REAL_LEDGER)
    assert entries
    assert entries[0]["week"] == "2026-W46"
    assert entries[0]["seq"] == 1


def test_every_approved_roundup_has_a_ledger_line():
    entries = read_entries(REAL_LEDGER)
    for path in ROUNDUPS.glob("*.json"):
        roundup = json.loads(path.read_text(encoding="utf-8"))
        if roundup.get("approved") is not True:
            continue
        week = roundup["week"]
        lines = [
            entry
            for entry in entries
            if entry.get("week") == week and entry.get("kind") == "roundup"
        ]
        assert lines, f"{week} is approved but has no ledger line"


def test_node_and_python_agree_on_the_real_ledger():
    node = shutil.which("node")
    if not node:
        pytest.skip("node is not installed")
    result = subprocess.run(
        [
            node,
            str(NODE_SCRIPT),
            "--json",
            "--path",
            str(REAL_LEDGER),
        ],
        cwd=REPO_ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    node_entries = json.loads(result.stdout)
    python_entries = [
        {"seq": entry["seq"], "hash": entry["hash"]}
        for entry in verify_file(REAL_LEDGER)
    ]
    assert node_entries == python_entries


def test_latest_for_week_returns_the_last_line():
    entries = read_entries(REAL_LEDGER)
    latest = latest_for_week(entries, "2026-W46")
    assert latest is not None
    assert latest["week"] == "2026-W46"
