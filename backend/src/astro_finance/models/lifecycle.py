"""Model registry, skip-on-unchanged and automatic promotion."""

from __future__ import annotations

import json
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import joblib

from .regime_forecast import (
    MIN_BALANCED_ACCURACY,
    build_dataset,
    config_fingerprint,
    dataset_fingerprint,
    load_frame,
    train_dataset,
)

PROMOTION_MIN_BALANCED_GAIN = 0.01
PROMOTION_MAX_BUCKET_LOSS = 0.05


class LifecycleError(RuntimeError):
    pass


def _read_json(path: Path) -> dict[str, Any] | None:
    if not path.is_file():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return payload if isinstance(payload, dict) else None


def load_production(previous_bundle: Path | None) -> tuple[dict[str, Any] | None, dict[str, Any] | None, Path | None]:
    if previous_bundle is None:
        return None, None, None
    registry = _read_json(previous_bundle / "models" / "registry.json")
    card = _read_json(previous_bundle / "models" / "model_card.json")
    model_path = previous_bundle / "models" / "model.joblib"
    if registry is None or card is None or not model_path.is_file():
        return None, None, None
    production = next(
        (
            item
            for item in registry.get("models", [])
            if isinstance(item, dict) and item.get("status") == "production"
        ),
        None,
    )
    if production is None or production.get("version") != card.get("model_version"):
        return None, None, None
    return registry, card, model_path


def _metrics(card: dict[str, Any]) -> dict[str, Any]:
    return card.get("walk_forward", {}).get("overall", {})


def _segments(card: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {
        str(item.get("bucket")): item
        for item in card.get("walk_forward", {}).get("per_segment", [])
        if isinstance(item, dict) and item.get("bucket") is not None
    }


def decide_promotion(
    candidate: dict[str, Any],
    production: dict[str, Any] | None,
) -> dict[str, Any]:
    """Apply the owner-approved promotion rule; never compare to itself."""

    candidate_metrics = _metrics(candidate)
    persistence = candidate.get("baselines", {}).get("persistence", {})
    historical_average = candidate.get("baselines", {}).get("historical_average", {})
    candidate_balanced = float(candidate_metrics.get("balanced_accuracy", 0.0))
    candidate_brier = float(candidate_metrics.get("brier", 1.0))
    persistence_balanced = float(persistence.get("balanced_accuracy", 0.0))
    historical_average_brier = float(historical_average.get("brier", 1.0))
    conditions: list[dict[str, Any]] = [
        {
            "condition": f"balanced accuracy >= {MIN_BALANCED_ACCURACY:.2f}",
            "pass": candidate_balanced >= MIN_BALANCED_ACCURACY,
            "candidate": candidate_balanced,
        },
        {
            "condition": "Brier score better than the historical average",
            "pass": candidate_brier < historical_average_brier,
            "candidate": candidate_brier,
            "historical_average": historical_average_brier,
        },
    ]

    if production is None:
        conditions.append(
            {
                "condition": "no existing production model",
                "pass": True,
                "reason": "first production model",
            }
        )
    else:
        production_metrics = _metrics(production)
        production_balanced = float(production_metrics.get("balanced_accuracy", 0.0))
        production_brier = float(production_metrics.get("brier", 1.0))
        conditions.append(
            {
                "condition": "balanced accuracy >= production + 0.01",
                "pass": candidate_balanced >= production_balanced + PROMOTION_MIN_BALANCED_GAIN,
                "candidate": candidate_balanced,
                "production": production_balanced,
            }
        )
        conditions.append(
            {
                "condition": "Brier score <= production",
                "pass": candidate_brier <= production_brier,
                "candidate": candidate_brier,
                "production": production_brier,
            }
        )

    conditions.append(
        {
            "condition": "beats the persistence baseline",
            "pass": candidate_balanced > persistence_balanced,
            "candidate": candidate_balanced,
            "persistence": persistence_balanced,
        }
    )

    if production is not None:
        candidate_segments = _segments(candidate)
        production_segments = _segments(production)
        bucket_checks = []
        for bucket, segment in candidate_segments.items():
            previous = production_segments.get(bucket)
            if previous is None:
                continue
            candidate_value = float(segment.get("balanced_accuracy", 0.0))
            production_value = float(previous.get("balanced_accuracy", 0.0))
            bucket_checks.append(
                {
                    "bucket": bucket,
                    "candidate": candidate_value,
                    "production": production_value,
                    "pass": candidate_value
                    >= production_value - PROMOTION_MAX_BUCKET_LOSS,
                }
            )
        conditions.append(
            {
                "condition": "no Core Index bucket worse by more than 0.05",
                "pass": all(item["pass"] for item in bucket_checks),
                "buckets": bucket_checks,
            }
        )

    failed = [item["condition"] for item in conditions if not item["pass"]]
    return {
        "status": "promoted" if not failed else "retired",
        "reason": (
            "all promotion conditions passed"
            if not failed
            else "failed: " + "; ".join(failed)
        ),
        "conditions": conditions,
        "candidate_metrics": candidate_metrics,
        "production_metrics": _metrics(production) if production else None,
        "persistence_metrics": persistence,
        "historical_average_metrics": historical_average,
    }


def _copy_previous_production(
    previous_bundle: Path | None, out_models: Path
) -> None:
    if previous_bundle is None:
        return
    for name in ("model.joblib", "model_card.json", "registry.json"):
        source = previous_bundle / "models" / name
        if source.is_file():
            shutil.copyfile(source, out_models / name)


def _registry_entry(
    *,
    version: str,
    status: str,
    card: dict[str, Any],
    promoted_at: str | None,
    previous_production: str | None,
) -> dict[str, Any]:
    return {
        "version": version,
        "status": status,
        "promoted_at": promoted_at,
        "previous_production": previous_production,
        "dataset_fingerprint": card.get("data", {}).get("fingerprint"),
        "metrics": _metrics(card),
        "model": "models/model.joblib" if status == "production" else None,
        "card": "models/model_card.json" if status == "production" else None,
    }


def run_training_job(
    *,
    data_path: Path,
    out_dir: Path,
    previous_bundle: Path | None = None,
    created_at: datetime | None = None,
) -> dict[str, Any]:
    """Train or skip, decide promotion, and write a bundle-ready models/ dir."""

    frame = load_frame(data_path)
    fingerprint = dataset_fingerprint(build_dataset(frame))
    config = config_fingerprint()
    registry, production_card, _ = load_production(previous_bundle)
    previous_promotion = (
        _read_json(previous_bundle / "models" / "promotion.json")
        if previous_bundle is not None
        else None
    )
    production_version = (
        str(production_card.get("model_version")) if production_card else None
    )

    models_dir = out_dir / "models"
    models_dir.mkdir(parents=True, exist_ok=True)
    promotion_path = models_dir / "promotion.json"

    previous_fingerprint = (
        (previous_promotion or {}).get("dataset_fingerprint")
        if previous_promotion
        else None
    )
    previous_config = (
        (previous_promotion or {}).get("config_fingerprint")
        if previous_promotion
        else None
    )
    if (
        previous_promotion is not None
        and previous_fingerprint == fingerprint
        and previous_config == config
    ):
        _copy_previous_production(previous_bundle, models_dir)
        promotion = {
            "status": "skipped",
            "reason": "dataset fingerprint and model config are unchanged",
            "candidate_version": None,
            "production_version": production_version,
            "dataset_fingerprint": fingerprint,
            "config_fingerprint": config,
        }
        promotion_path.write_text(json.dumps(promotion, indent=2), encoding="utf-8")
        return promotion

    model, candidate_card = train_dataset(data_path, created_at=created_at)
    candidate_card["dataset_fingerprint"] = fingerprint
    candidate_card["config_fingerprint"] = config
    decision = decide_promotion(candidate_card, production_card)
    promoted = decision["status"] == "promoted"
    now = (created_at or datetime.now(timezone.utc)).isoformat().replace("+00:00", "Z")

    if promoted:
        joblib.dump(model, models_dir / "model.joblib")
        (models_dir / "model_card.json").write_text(
            json.dumps(candidate_card, indent=2), encoding="utf-8"
        )
        models = [
            item
            for item in (registry or {}).get("models", [])
            if isinstance(item, dict)
        ]
        for item in models:
            if item.get("status") == "production":
                item["status"] = "retired"
        models.append(
            _registry_entry(
                version=str(candidate_card["model_version"]),
                status="production",
                card=candidate_card,
                promoted_at=now,
                previous_production=production_version,
            )
        )
    else:
        _copy_previous_production(previous_bundle, models_dir)
        models = [
            item
            for item in (registry or {}).get("models", [])
            if isinstance(item, dict)
        ]
        models.append(
            _registry_entry(
                version=str(candidate_card["model_version"]),
                status="retired",
                card=candidate_card,
                promoted_at=None,
                previous_production=production_version,
            )
        )

    registry_payload = {
        "schema_version": 1,
        "updated_at": now,
        "models": models,
    }
    (models_dir / "registry.json").write_text(
        json.dumps(registry_payload, indent=2), encoding="utf-8"
    )
    promotion = {
        "status": decision["status"],
        "reason": decision["reason"],
        "candidate_version": candidate_card["model_version"],
        "production_version": (
            candidate_card["model_version"] if promoted else production_version
        ),
        "previous_production": production_version,
        "dataset_fingerprint": fingerprint,
        "config_fingerprint": config,
        "candidate_metrics": decision["candidate_metrics"],
        "production_metrics": decision["production_metrics"],
        "persistence_metrics": decision["persistence_metrics"],
        "historical_average_metrics": decision["historical_average_metrics"],
        "conditions": decision["conditions"],
    }
    promotion_path.write_text(json.dumps(promotion, indent=2), encoding="utf-8")
    return promotion
