"""Side effects kept out of the stage transforms: raw cache, rejects, state."""

from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import TYPE_CHECKING, Mapping

from .models import Event
from .security import redact_secrets

if TYPE_CHECKING:  # pragma: no cover - typing only
    from .runtime import PipelineContext


def write_raw(
    out_dir: Path,
    source_id: str,
    payloads: Mapping[str, bytes],
    error: str | None,
) -> list[Path]:
    raw_dir = out_dir / "raw" / source_id
    if raw_dir.exists():
        shutil.rmtree(raw_dir)
    raw_dir.mkdir(parents=True, exist_ok=True)
    written = []
    for name, data in sorted(payloads.items()):
        filename = Path(name).name or "payload.bin"
        path = raw_dir / filename
        path.write_bytes(data)
        written.append(path)
    if error:
        path = raw_dir / "error.txt"
        path.write_text(redact_secrets(error) + "\n", encoding="utf-8")
        written.append(path)
    return written


def write_rejects(ctx: "PipelineContext") -> None:
    ordered = sorted(
        ctx.rejects,
        key=lambda item: (
            str(item.get("source_id", "")),
            str(item.get("name", "")),
            str(item.get("reasons", "")),
        ),
    )
    payload = {
        "schema_version": 1,
        "as_of": ctx.options.today.isoformat(),
        "rejects": ordered,
    }
    (ctx.options.out_dir / "rejects.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, default=str) + "\n",
        encoding="utf-8",
    )


def load_previous(ctx: "PipelineContext") -> None:
    from .runtime import PipelineError

    previous_dir = ctx.options.previous_dir
    if previous_dir is None:
        return
    events_path = previous_dir / "events.json"
    if not events_path.exists():
        raise PipelineError(f"previous bundle has no events.json: {events_path}")
    payload = json.loads(events_path.read_text(encoding="utf-8"))
    ctx.previous_events = [Event.from_dict(item) for item in payload.get("events", [])]
    manifest_path = previous_dir / "manifest.json"
    if manifest_path.exists():
        ctx.previous_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        ctx.previous_historical_source_sha256 = ctx.previous_manifest.get(
            "historical_source_sha256"
        )


def summary(ctx: "PipelineContext") -> dict[str, int]:
    historical = sum(1 for event in ctx.events if event.kind.value == "historical")
    upcoming = sum(1 for event in ctx.events if event.kind.value == "upcoming")
    return {
        "events_discovered": sum(ctx.extracted_counts.values()),
        "events_updated": ctx.lifecycle.updated_count if ctx.lifecycle else 0,
        "events_rejected": sum(ctx.rejected_counts.values()),
        "events_retired": (
            len(ctx.lifecycle.retired_ids) if ctx.lifecycle else 0
        ),
        "duplicates_removed": ctx.dedup.duplicates if ctx.dedup else 0,
        "events_total": len(ctx.events),
        "historical_total": historical,
        "upcoming_total": upcoming,
    }
