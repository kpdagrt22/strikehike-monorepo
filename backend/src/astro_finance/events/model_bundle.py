"""Read and validate the candidate model directory that goes into a bundle."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .gates import GateResult


def models_root(model_dir: Path) -> Path:
    source = Path(model_dir)
    if (source / "models").is_dir():
        return source / "models"
    return source


def _json(path: Path) -> dict[str, Any] | None:
    if not path.is_file():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return payload if isinstance(payload, dict) else None


def model_info(model_dir: Path | None) -> dict[str, Any] | None:
    if model_dir is None:
        return None
    root = models_root(model_dir)
    promotion = _json(root / "promotion.json") or {}
    registry = _json(root / "registry.json") or {}
    production = [
        item
        for item in registry.get("models", [])
        if isinstance(item, dict) and item.get("status") == "production"
    ]
    production_entry = production[0] if len(production) == 1 else None
    return {
        "status": promotion.get("status", "missing"),
        "reason": promotion.get("reason", "promotion.json is missing"),
        "candidate_version": promotion.get("candidate_version"),
        "production_version": (
            production_entry.get("version") if production_entry else None
        ),
        "dataset_fingerprint": promotion.get("dataset_fingerprint"),
        "training_skipped": promotion.get("status") == "skipped",
        "candidate_metrics": promotion.get("candidate_metrics"),
        "production_metrics": promotion.get("production_metrics"),
        "persistence_metrics": promotion.get("persistence_metrics"),
        "conditions": promotion.get("conditions", []),
        "production_present": production_entry is not None,
        "registry_entries": len(registry.get("models", [])),
    }


def model_gate(model_dir: Path | None) -> GateResult | None:
    if model_dir is None:
        return None
    root = models_root(model_dir)
    problems = []
    if not (root / "promotion.json").is_file():
        problems.append("promotion.json is missing")
    if not (root / "registry.json").is_file():
        problems.append("registry.json is missing")
    if not (root / "model_card.json").is_file():
        problems.append("model_card.json is missing")
    if not (root / "model.joblib").is_file():
        problems.append("model.joblib is missing")
    promotion = _json(root / "promotion.json") or {}
    registry = _json(root / "registry.json") or {}
    card = _json(root / "model_card.json") or {}
    status = promotion.get("status")
    if status not in {"promoted", "retired", "skipped"}:
        problems.append(f"promotion status is {status!r}")
    productions = [
        item
        for item in registry.get("models", [])
        if isinstance(item, dict) and item.get("status") == "production"
    ]
    if len(productions) != 1:
        problems.append(
            f"registry must contain exactly one production model, found {len(productions)}"
        )
    elif productions[0].get("version") != card.get("model_version"):
        problems.append("production registry entry does not match model_card.json")
    if problems:
        return GateResult("model_lifecycle", "fail", "; ".join(problems))
    return GateResult(
        "model_lifecycle",
        "pass",
        f"production model {productions[0].get('version')} "
        f"({status}); {len(registry.get('models', []))} registry entries",
    )
