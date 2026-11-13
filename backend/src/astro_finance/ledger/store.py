"""Read, verify and append ledger lines.

The file lives in ``frontend/content/ledger/ledger.jsonl`` so the Next app can
serve it at ``/ledger.jsonl``. Every append verifies the whole chain first and
only ever adds a line.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import re
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path
from typing import Any, Callable

import httpx

from astro_finance.digest import settings

from .canonical import CanonicalError, ledger_hash

ZERO_HASH = "0" * 64
REPO_ROOT = Path(__file__).resolve().parents[4]
DEFAULT_LEDGER = REPO_ROOT / "frontend" / "content" / "ledger" / "ledger.jsonl"
ROUNDUPS = REPO_ROOT / "frontend" / "content" / "roundups"
WEEK_RE = re.compile(r"^\d{4}-W\d{2}$")


def normalise_newlines(raw: bytes) -> bytes:
    """The committed file's stable form: LF only, every OS."""
    return raw.replace(b"\r\n", b"\n")


class LedgerError(ValueError):
    pass


def short_hash(value: str) -> str:
    return (value or "")[:12]


def read_entries(path: str | Path | None = None) -> list[dict[str, Any]]:
    ledger = Path(path or DEFAULT_LEDGER)
    if not ledger.exists():
        return []
    entries: list[dict[str, Any]] = []
    try:
        text = ledger.read_text(encoding="utf-8")
    except OSError as exc:
        raise LedgerError(f"cannot read {ledger}") from exc
    for number, line in enumerate(text.splitlines(), 1):
        if not line.strip():
            continue
        try:
            entry = json.loads(line)
        except json.JSONDecodeError as exc:
            raise LedgerError(f"line {number}: invalid JSON") from exc
        if not isinstance(entry, dict):
            raise LedgerError(f"line {number}: not an object")
        entries.append(entry)
    return entries


def verify_entries(entries: list[dict[str, Any]]) -> None:
    previous = ZERO_HASH
    for index, entry in enumerate(entries, 1):
        seq = entry.get("seq")
        if seq != index:
            raise LedgerError(f"seq {seq}: expected {index}")
        if entry.get("prev_hash") != previous:
            raise LedgerError(f"seq {seq}: prev_hash does not link")
        stored = entry.get("hash")
        if not isinstance(stored, str) or len(stored) != 64:
            raise LedgerError(f"seq {seq}: bad hash")
        try:
            computed = ledger_hash(entry)
        except CanonicalError as exc:
            raise LedgerError(f"seq {seq}: {exc}") from exc
        if not hmac.compare_digest(stored, computed):
            raise LedgerError(f"seq {seq}: hash does not match")
        previous = stored


def verify_file(path: str | Path | None = None) -> list[dict[str, Any]]:
    entries = read_entries(path)
    verify_entries(entries)
    return entries


def latest_for_week(
    entries: list[dict[str, Any]], week: str
) -> dict[str, Any] | None:
    found = None
    for entry in entries:
        if entry.get("week") == week:
            found = entry
    return found


def _published_at(value: str | None) -> str:
    if not value:
        moment = datetime.now(timezone.utc)
    else:
        text = value.strip()
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"
        try:
            moment = datetime.fromisoformat(text)
        except ValueError as exc:
            raise LedgerError("published_at must be ISO 8601") from exc
        if moment.tzinfo is None:
            moment = moment.replace(tzinfo=timezone.utc)
        moment = moment.astimezone(timezone.utc)
    return moment.replace(microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ")


def format_core_index(value: Any) -> str:
    """The one place a reading becomes its stored string, exactly one decimal."""

    try:
        core = Decimal(str(value)).quantize(
            Decimal("0.1"), rounding=ROUND_HALF_UP
        )
    except (InvalidOperation, ValueError) as exc:
        raise LedgerError("roundup Regime score is not a number") from exc
    return format(core, "f")


def _reading(roundup: dict[str, Any]) -> dict[str, Any]:
    regime = roundup.get("regime")
    if not isinstance(regime, dict):
        raise LedgerError("roundup has no Regime reading")
    score = regime.get("score")
    label = regime.get("label")
    as_of = regime.get("as_of")
    if score is None or not label or not as_of:
        raise LedgerError("roundup Regime reading is incomplete")
    return {
        "core_index": format_core_index(score),
        "label": str(label),
        "as_of": str(as_of),
    }


def fetch_roundup(
    week: str,
    *,
    roundups_dir: str | Path | None = None,
) -> tuple[dict[str, Any], bytes]:
    """Read the committed roundup file and hash its LF-normalised bytes.

    No HTTP call is involved: the file is the permanent record the public
    ``/roundup.json`` route serves.
    """

    directory = Path(roundups_dir or ROUNDUPS)
    path = directory / f"{week}.json"
    if not path.exists():
        raise LedgerError(f"{week} is not approved")
    try:
        raw = normalise_newlines(path.read_bytes())
        data = json.loads(raw.decode("utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise LedgerError(f"cannot read {path.name}") from exc
    if not isinstance(data, dict) or data.get("approved") is not True:
        raise LedgerError(f"{week} is not approved")
    if data.get("week") != week:
        raise LedgerError(f"roundup file is {data.get('week')}, not {week}")
    return data, raw


def fetch_ledger_entry(
    week: str,
    *,
    base_url: str | None = None,
    transport: httpx.BaseTransport | None = None,
) -> dict[str, Any] | None:
    root = (base_url or settings.content_base_url()).rstrip("/")
    url = f"{root}/ledger.jsonl"
    try:
        with httpx.Client(
            transport=transport, timeout=15.0, follow_redirects=True
        ) as client:
            response = client.get(url)
    except httpx.HTTPError as exc:
        raise LedgerError(f"ledger route is unreachable: {exc}") from exc
    if response.status_code == 404:
        return None
    if response.status_code != 200:
        raise LedgerError(f"ledger route returned HTTP {response.status_code}")
    entries = []
    for number, line in enumerate(response.text.splitlines(), 1):
        if not line.strip():
            continue
        try:
            entry = json.loads(line)
        except json.JSONDecodeError as exc:
            raise LedgerError(f"ledger line {number}: invalid JSON") from exc
        if isinstance(entry, dict):
            entries.append(entry)
    verify_entries(entries)
    return latest_for_week(entries, week)


def append_entry(
    week: str,
    *,
    path: str | Path | None = None,
    published_at: str | None = None,
    correction_of: int | None = None,
    reason: str | None = None,
    dry_run: bool = False,
    fetch: Callable[[str], tuple[dict[str, Any], bytes]] | None = None,
) -> dict[str, Any]:
    if not WEEK_RE.match(week or ""):
        raise LedgerError("week must be YYYY-Www")
    ledger = Path(path or DEFAULT_LEDGER)
    entries = read_entries(ledger)
    verify_entries(entries)

    if correction_of is None:
        if any(entry.get("week") == week for entry in entries):
            raise LedgerError(f"{week} already has a ledger line")
    else:
        if not isinstance(correction_of, int) or correction_of < 1:
            raise LedgerError("--correction-of must be a positive seq")
        target = next(
            (entry for entry in entries if entry.get("seq") == correction_of),
            None,
        )
        if target is None:
            raise LedgerError(f"seq {correction_of} does not exist")
        if target.get("week") != week:
            raise LedgerError("correction week does not match the target")
        if not reason or not reason.strip():
            raise LedgerError("a correction needs a short reason")

    roundup, raw = (fetch or fetch_roundup)(week)
    reading = _reading(roundup)
    entry: dict[str, Any] = {
        "seq": (entries[-1]["seq"] + 1) if entries else 1,
        "week": week,
        "published_at": _published_at(published_at),
        "kind": "correction" if correction_of is not None else "roundup",
        "reading": reading,
        "roundup_sha256": hashlib.sha256(raw).hexdigest(),
        "prev_hash": entries[-1]["hash"] if entries else ZERO_HASH,
    }
    if correction_of is not None:
        entry["corrects_seq"] = correction_of
        entry["reason"] = reason.strip()
    entry["hash"] = ledger_hash(entry)

    if not dry_run:
        ledger.parent.mkdir(parents=True, exist_ok=True)
        line = json.dumps(
            entry, ensure_ascii=False, separators=(",", ":"), sort_keys=True
        )
        with ledger.open("a", encoding="utf-8", newline="\n") as handle:
            handle.write(line + "\n")
    return entry
