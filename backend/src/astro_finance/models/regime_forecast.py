"""Production macro-regime forecast model: data, walk-forward and training."""

from __future__ import annotations

import hashlib
import json
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    balanced_accuracy_score,
    brier_score_loss,
    log_loss,
)
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

FEATURE_COLUMNS = ("fed_cross", "curve_cross", "sahm_alert")
TARGET_COLUMN = "sp500_lower_4w"
HORIZON_DAYS = 28
PURGE_DAYS = 28
RANDOM_SEED = 42
FIRST_TEST_YEAR = 2000
MIN_TRAIN_ROWS = 250
MIN_TEST_ROWS = 20
CORE_SEGMENT = "core_index_bucket"
DEFAULT_CONFIG = {
    "features": list(FEATURE_COLUMNS),
    "target": TARGET_COLUMN,
    "horizon_days": HORIZON_DAYS,
    "purge_days": PURGE_DAYS,
    "seed": RANDOM_SEED,
    "first_test_year": FIRST_TEST_YEAR,
}


class ModelTrainingError(RuntimeError):
    pass


class LookaheadError(ModelTrainingError):
    pass


@dataclass(frozen=True, slots=True)
class WalkForwardResult:
    overall: dict[str, Any]
    baselines: dict[str, Any]
    calibration: list[dict[str, Any]]
    per_segment: list[dict[str, Any]]
    folds: list[dict[str, Any]]


def load_frame(path: Path) -> pd.DataFrame:
    try:
        frame = pd.read_parquet(path)
    except (OSError, ValueError) as exc:
        raise ModelTrainingError(f"cannot read parquet: {exc}") from exc
    if "sp500_proxy" not in frame.columns:
        raise ModelTrainingError("dataset has no sp500_proxy column")
    index = pd.to_datetime(frame.index, utc=True)
    frame = frame.copy()
    frame.index = index
    return frame.sort_index()


def dataset_fingerprint(frame: pd.DataFrame) -> str:
    """Stable data fingerprint independent of parquet metadata."""

    hashed = pd.util.hash_pandas_object(frame, index=True).values.tobytes()
    return hashlib.sha256(hashed).hexdigest()[:16]


def config_fingerprint(config: dict[str, Any] | None = None) -> str:
    payload = config or DEFAULT_CONFIG
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()[:12]


def build_dataset(frame: pd.DataFrame) -> pd.DataFrame:
    missing = [
        column
        for column in (*FEATURE_COLUMNS, "sp500_proxy", CORE_SEGMENT)
        if column not in frame.columns
    ]
    if missing:
        raise ModelTrainingError(
            "dataset is missing model columns: " + ", ".join(missing)
        )
    data = frame[[*FEATURE_COLUMNS, "sp500_proxy", CORE_SEGMENT]].copy()
    data["sahm_alert"] = (
        data["sahm_alert"].astype("boolean").fillna(False).astype(float)
    )
    price = data["sp500_proxy"].astype(float)
    future = price.shift(-HORIZON_DAYS)
    trailing = price / price.shift(HORIZON_DAYS) - 1.0
    target = (future / price - 1.0 < 0.0).astype(float)
    target[future.isna() | price.isna()] = np.nan
    data[TARGET_COLUMN] = target
    # Persistence: the current four-week direction continues.
    data["persistence"] = (trailing < 0.0).astype(float)
    return data


def assert_no_lookahead(
    data: pd.DataFrame,
    *,
    features: Iterable[str] = FEATURE_COLUMNS,
    target: str = TARGET_COLUMN,
    horizon_days: int = HORIZON_DAYS,
) -> None:
    """Fail on same-row leakage or a target that is a feature in disguise."""

    feature_list = list(features)
    if horizon_days <= 0:
        raise LookaheadError("target horizon must be positive")
    if target in feature_list:
        raise LookaheadError("target is also a feature")
    for column in feature_list:
        if column not in data.columns:
            raise LookaheadError(f"feature is missing: {column}")
    usable = data[[*feature_list, target]].dropna()
    if len(usable) < 50:
        raise LookaheadError("not enough rows to guard the target")
    y = usable[target].astype(float)
    for column in feature_list:
        x = usable[column].astype(float)
        if x.nunique() <= 1 or y.nunique() <= 1:
            continue
        correlation = float(np.corrcoef(x, y)[0, 1])
        if abs(correlation) >= 0.999:
            raise LookaheadError(
                f"feature {column!r} is perfectly correlated with the target"
            )


def _metrics(y: np.ndarray, probability: np.ndarray) -> dict[str, Any]:
    prediction = (probability >= 0.5).astype(int)
    return {
        "accuracy": round(float(accuracy_score(y, prediction)), 6),
        "balanced_accuracy": round(
            float(balanced_accuracy_score(y, prediction)), 6
        ),
        "brier": round(float(brier_score_loss(y, probability)), 6),
        "log_loss": round(float(log_loss(y, probability, labels=[0, 1])), 6),
        "observations": int(len(y)),
        "base_rate": round(float(y.mean()), 6),
    }


def _calibration(y: np.ndarray, probability: np.ndarray) -> list[dict[str, Any]]:
    bins = np.linspace(0.0, 1.0, 11)
    table = []
    for lower, upper in zip(bins[:-1], bins[1:]):
        mask = (probability >= lower) & (
            probability < upper if upper < 1.0 else probability <= upper
        )
        if not mask.any():
            continue
        table.append(
            {
                "lower": round(float(lower), 2),
                "upper": round(float(upper), 2),
                "count": int(mask.sum()),
                "mean_predicted": round(float(probability[mask].mean()), 6),
                "observed": round(float(y[mask].mean()), 6),
            }
        )
    return table


def _segments(
    frame: pd.DataFrame,
    y: np.ndarray,
    probability: np.ndarray,
) -> list[dict[str, Any]]:
    rows = []
    for bucket, index in frame.groupby(CORE_SEGMENT, dropna=True).groups.items():
        positions = frame.index.get_indexer(index)
        mask = positions >= 0
        if not mask.any():
            continue
        positions = positions[mask]
        segment_y = y[positions]
        segment_probability = probability[positions]
        if len(segment_y) < 10:
            continue
        metrics = _metrics(segment_y, segment_probability)
        metrics["bucket"] = str(bucket)
        rows.append(metrics)
    return sorted(rows, key=lambda row: row["bucket"])


def walk_forward(data: pd.DataFrame) -> WalkForwardResult:
    labeled = data.dropna(subset=[*FEATURE_COLUMNS, TARGET_COLUMN])
    if labeled.empty:
        raise ModelTrainingError("no labeled observations")
    years = range(max(FIRST_TEST_YEAR, labeled.index.min().year + 5), labeled.index.max().year + 1)
    all_y: list[int] = []
    all_probability: list[float] = []
    all_persistence: list[float] = []
    all_frames: list[pd.DataFrame] = []
    folds: list[dict[str, Any]] = []

    for year in years:
        year_start = pd.Timestamp(f"{year}-01-01", tz="UTC")
        purge_start = year_start - pd.Timedelta(days=PURGE_DAYS)
        train = labeled[labeled.index < purge_start]
        test = labeled[labeled.index.year == year]
        if len(train) < MIN_TRAIN_ROWS or len(test) < MIN_TEST_ROWS:
            continue
        model = make_pipeline(
            StandardScaler(),
            LogisticRegression(
                max_iter=2000, solver="lbfgs", random_state=RANDOM_SEED
            ),
        )
        x_train = train[list(FEATURE_COLUMNS)].astype(float)
        y_train = train[TARGET_COLUMN].astype(int)
        x_test = test[list(FEATURE_COLUMNS)].astype(float)
        y_test = test[TARGET_COLUMN].astype(int)
        model.fit(x_train, y_train)
        probability = model.predict_proba(x_test)[:, 1]
        majority = int(y_train.mean() >= 0.5)
        persistence = test["persistence"].fillna(majority).astype(int)
        fold_metrics = _metrics(y_test.to_numpy(), probability)
        folds.append(
            {
                "year": year,
                "train_start": train.index.min().date().isoformat(),
                "train_end": train.index.max().date().isoformat(),
                "train_observations": int(len(train)),
                "test_start": test.index.min().date().isoformat(),
                "test_end": test.index.max().date().isoformat(),
                "test_observations": int(len(test)),
                **fold_metrics,
            }
        )
        all_y.extend(y_test.astype(int).tolist())
        all_probability.extend(float(value) for value in probability)
        all_persistence.extend(persistence.tolist())
        all_frames.append(test.copy())

    if not all_y:
        raise ModelTrainingError("no walk-forward folds met the minimum size")
    y = np.asarray(all_y, dtype=int)
    probability = np.asarray(all_probability, dtype=float)
    persistence = np.asarray(all_persistence, dtype=float)
    segment_frame = pd.concat(all_frames)
    majority_probability = np.full_like(probability, float(y.mean() >= 0.5))
    overall = _metrics(y, probability)
    baselines = {
        "majority": _metrics(y, majority_probability),
        "persistence": _metrics(y, persistence),
    }
    return WalkForwardResult(
        overall=overall,
        baselines=baselines,
        calibration=_calibration(y, probability),
        per_segment=_segments(segment_frame, y, probability),
        folds=folds,
    )


def train_final_model(data: pd.DataFrame) -> tuple[Any, dict[str, Any]]:
    labeled = data.dropna(subset=[*FEATURE_COLUMNS, TARGET_COLUMN])
    if len(labeled) < MIN_TRAIN_ROWS:
        raise ModelTrainingError("not enough observations to fit the model")
    model = make_pipeline(
        StandardScaler(),
        LogisticRegression(
            max_iter=2000, solver="lbfgs", random_state=RANDOM_SEED
        ),
    )
    model.fit(
        labeled[list(FEATURE_COLUMNS)].astype(float),
        labeled[TARGET_COLUMN].astype(int),
    )
    classifier = model[-1]
    coefficients = {
        column: round(float(value), 8)
        for column, value in zip(FEATURE_COLUMNS, classifier.coef_[0])
    }
    return model, {
        "coefficients": coefficients,
        "intercept": round(float(classifier.intercept_[0]), 8),
        "observations": int(len(labeled)),
        "start": labeled.index.min().date().isoformat(),
        "end": labeled.index.max().date().isoformat(),
        "base_rate": round(float(labeled[TARGET_COLUMN].mean()), 6),
    }


def build_model_card(
    *,
    data: pd.DataFrame,
    path: Path,
    walk: WalkForwardResult,
    fit: dict[str, Any],
    created_at: datetime | None = None,
) -> dict[str, Any]:
    fingerprint = dataset_fingerprint(data)
    signature = hashlib.sha256(
        json.dumps(
            {
                "fingerprint": fingerprint,
                "coefficients": fit["coefficients"],
                "intercept": fit["intercept"],
                "config": DEFAULT_CONFIG,
            },
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()[:8]
    version = f"rf-{fingerprint[:8]}-{signature}"
    return {
        "schema_version": 1,
        "model_version": version,
        "created_at": (created_at or datetime.now(timezone.utc)).isoformat().replace(
            "+00:00", "Z"
        ),
        "model_type": "logistic_regression",
        "config": DEFAULT_CONFIG,
        "config_fingerprint": config_fingerprint(),
        "features": list(FEATURE_COLUMNS),
        "target": {
            "name": TARGET_COLUMN,
            "definition": (
                "S&P 500 proxy lower 28 calendar days after each observation"
            ),
            "horizon_days": HORIZON_DAYS,
            "persistence": (
                "the current trailing 28-day S&P 500 direction continues"
            ),
        },
        "data": {
            "path": str(path),
            "fingerprint": fingerprint,
            "data_version": fingerprint,
            "rows": int(len(data)),
            "start": data.index.min().date().isoformat(),
            "end": data.index.max().date().isoformat(),
        },
        "training": {
            "start": fit["start"],
            "end": fit["end"],
            "observations": fit["observations"],
            "base_rate": fit["base_rate"],
            "purge_days": PURGE_DAYS,
            "random_seed": RANDOM_SEED,
        },
        "walk_forward": {
            "method": "expanding window, yearly folds, purged by horizon",
            "purge_days": PURGE_DAYS,
            "folds": walk.folds,
            "overall": walk.overall,
            "calibration": walk.calibration,
            "per_segment": walk.per_segment,
        },
        "baselines": walk.baselines,
        "coefficients": fit["coefficients"],
        "intercept": fit["intercept"],
        "notes": [
            "The target is forward-looking and uses the S&P 500 proxy 28 calendar days later.",
            "The 28-day purge gap prevents train labels from overlapping the test fold.",
            "Persistence means the trailing 28-day direction continues.",
            "Descriptive macro risk only; not a security-specific return forecast.",
        ],
    }


def train_dataset(path: Path, created_at: datetime | None = None) -> tuple[Any, dict[str, Any]]:
    frame = load_frame(path)
    data = build_dataset(frame)
    assert_no_lookahead(data)
    walk = walk_forward(data)
    model, fit = train_final_model(data)
    card = build_model_card(
        data=data, path=path, walk=walk, fit=fit, created_at=created_at
    )
    return model, card


def main(argv: list[str] | None = None) -> int:
    import argparse

    parser = argparse.ArgumentParser(
        description="Train and promote the macro-regime forecast model."
    )
    subparsers = parser.add_subparsers(dest="command", required=True)
    train = subparsers.add_parser("train", help="train, evaluate and decide promotion")
    train.add_argument("--data", type=Path, required=True, help="macro parquet")
    train.add_argument("--out", type=Path, required=True, help="output directory")
    train.add_argument(
        "--previous-bundle",
        type=Path,
        help="previous events bundle with models/ for skip and promotion comparison",
    )
    args = parser.parse_args(argv)

    from .lifecycle import LifecycleError, run_training_job

    try:
        promotion = run_training_job(
            data_path=args.data,
            out_dir=args.out,
            previous_bundle=args.previous_bundle,
        )
    except (ModelTrainingError, LifecycleError, OSError) as exc:
        print(f"model training failed: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(promotion, indent=2))
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())

