from __future__ import annotations

import json
import shutil
from pathlib import Path

import numpy as np
import pandas as pd
import pytest
import joblib

from astro_finance.events.bundle import write_dataset
from astro_finance.events.macro_data import validate_macro_refresh
from astro_finance.models.lifecycle import decide_promotion, run_training_job
from astro_finance.models.regime_forecast import (
    HORIZON_DAYS,
    TARGET_COLUMN,
    assert_no_lookahead,
    build_dataset,
    train_dataset,
)

DATA = Path(__file__).resolve().parents[2] / "data" / "processed" / "macro_regime_history.parquet"


def _synthetic_frame() -> pd.DataFrame:
    index = pd.date_range("2019-01-01", "2021-12-31", freq="D", tz="UTC")
    price = pd.Series(np.exp(np.linspace(6.0, 7.0, len(index))), index=index)
    frame = pd.DataFrame(
        {
            "fed_cross": np.linspace(-0.5, 0.5, len(index)),
            "curve_cross": np.linspace(0.4, -0.4, len(index)),
            "sahm_alert": np.zeros(len(index), dtype=bool),
            "sp500_proxy": price,
            "core_index_bucket": "calm_bullish",
        },
        index=index,
    )
    frame.loc[frame.index[100:200], "sahm_alert"] = True
    return frame


def test_target_uses_the_forward_28_day_price():
    frame = _synthetic_frame()
    data = build_dataset(frame)
    for position in (0, 50, len(data) - HORIZON_DAYS - 1):
        current = float(frame["sp500_proxy"].iloc[position])
        future = float(frame["sp500_proxy"].iloc[position + HORIZON_DAYS])
        assert data[TARGET_COLUMN].iloc[position] == float(future < current)
    assert data[TARGET_COLUMN].iloc[-HORIZON_DAYS:].isna().all()


def test_lookahead_guard_rejects_a_target_made_from_a_feature():
    data = build_dataset(_synthetic_frame())
    data[TARGET_COLUMN] = data["fed_cross"]
    with pytest.raises(Exception, match="perfectly correlated|target"):
        assert_no_lookahead(data)


def test_walk_forward_and_model_card_on_the_real_dataset():
    model, card = train_dataset(DATA)
    assert model is not None
    assert card["features"] == ["fed_cross", "curve_cross", "sahm_alert"]
    assert card["target"]["name"] == TARGET_COLUMN
    assert card["target"]["horizon_days"] == HORIZON_DAYS
    assert card["walk_forward"]["folds"]
    assert card["walk_forward"]["overall"]["observations"] > 1000
    assert card["baselines"]["majority"]["observations"] == card["walk_forward"]["overall"]["observations"]
    assert card["walk_forward"]["calibration"]
    assert card["walk_forward"]["per_segment"]
    assert card["training"]["purge_days"] == 28


def test_training_is_deterministic():
    _, first = train_dataset(DATA)
    _, second = train_dataset(DATA)
    assert first["coefficients"] == second["coefficients"]
    assert first["intercept"] == second["intercept"]
    assert first["walk_forward"]["overall"] == second["walk_forward"]["overall"]
    assert first["walk_forward"]["folds"] == second["walk_forward"]["folds"]


def test_training_skips_when_the_dataset_fingerprint_is_unchanged(tmp_path):
    first = tmp_path / "first"
    second = tmp_path / "second"
    one = run_training_job(data_path=DATA, out_dir=first)
    assert one["status"] in {"promoted", "retired"}
    two = run_training_job(
        data_path=DATA, out_dir=second, previous_bundle=first
    )
    assert two["status"] == "skipped"
    assert "fingerprint" in two["reason"]
    assert (second / "models" / "model.joblib").is_file()


def test_registry_keeps_the_previous_production_for_rollback(tmp_path):
    changed = tmp_path / "changed.parquet"
    frame = pd.read_parquet(DATA)
    frame.index = pd.to_datetime(frame.index, utc=True)
    frame.loc[frame.index[-10:], "sp500_proxy"] *= 0.98
    _write_copy(changed, frame)
    first = tmp_path / "first"
    second = tmp_path / "second"
    first_decision = run_training_job(data_path=DATA, out_dir=first)
    assert first_decision["status"] in {"promoted", "retired"}
    second_decision = run_training_job(
        data_path=changed, out_dir=second, previous_bundle=first
    )
    first_card = json.loads(
        (first / "models" / "model_card.json").read_text("utf-8")
    )
    registry = json.loads(
        (second / "models" / "registry.json").read_text("utf-8")
    )
    productions = [
        item for item in registry["models"] if item["status"] == "production"
    ]
    assert len(productions) == 1
    if second_decision["status"] == "retired":
        assert productions[0]["version"] == first_card["model_version"]
        candidate = next(
            item
            for item in registry["models"]
            if item["version"] == second_decision["candidate_version"]
        )
        assert candidate["status"] == "retired"
        assert candidate["previous_production"] == first_card["model_version"]
    else:
        previous = next(
            item
            for item in registry["models"]
            if item["version"] == first_card["model_version"]
        )
        assert previous["status"] == "retired"
        assert productions[0]["previous_production"] == first_card["model_version"]


def _card(
    *,
    version: str = "candidate",
    balanced: float = 0.60,
    brier: float = 0.20,
    bucket: float = 0.55,
    persistence: float = 0.50,
) -> dict:
    return {
        "model_version": version,
        "walk_forward": {
            "overall": {
                "balanced_accuracy": balanced,
                "brier": brier,
                "observations": 100,
            },
            "per_segment": [
                {"bucket": "calm_bullish", "balanced_accuracy": bucket},
                {"bucket": "bearish_warning", "balanced_accuracy": bucket},
            ],
        },
        "baselines": {
            "persistence": {
                "balanced_accuracy": persistence,
                "brier": 0.30,
                "observations": 100,
            }
        },
    }


def test_promotion_passes_all_conditions():
    candidate = _card(balanced=0.60)
    production = _card(version="production", balanced=0.58, brier=0.21, bucket=0.54)
    decision = decide_promotion(candidate, production)
    assert decision["status"] == "promoted"


def test_promotion_requires_a_full_point_of_balanced_accuracy():
    candidate = _card(balanced=0.585)
    production = _card(version="production", balanced=0.58, brier=0.21)
    decision = decide_promotion(candidate, production)
    assert decision["status"] == "retired"
    assert "balanced accuracy" in decision["reason"]


def test_promotion_requires_brier_not_to_worsen():
    candidate = _card(balanced=0.60, brier=0.25)
    production = _card(version="production", balanced=0.58, brier=0.21)
    decision = decide_promotion(candidate, production)
    assert decision["status"] == "retired"
    assert "Brier" in decision["reason"]


def test_promotion_requires_beating_persistence():
    candidate = _card(balanced=0.50, persistence=0.50)
    production = _card(version="production", balanced=0.49)
    decision = decide_promotion(candidate, production)
    assert decision["status"] == "retired"
    assert "persistence" in decision["reason"]


def test_promotion_rejects_a_worse_core_index_bucket():
    candidate = _card(balanced=0.65, bucket=0.40)
    production = _card(version="production", balanced=0.58, bucket=0.50)
    decision = decide_promotion(candidate, production)
    assert decision["status"] == "retired"
    assert "bucket" in decision["reason"]


def test_promotion_of_a_first_model_requires_beating_persistence():
    candidate = _card(balanced=0.51, persistence=0.50)
    assert decide_promotion(candidate, None)["status"] == "promoted"
    weak = _card(balanced=0.49, persistence=0.50)
    assert decide_promotion(weak, None)["status"] == "retired"


def _write_copy(path: Path, frame: pd.DataFrame) -> None:
    frame.to_parquet(path, engine="pyarrow", compression="snappy")


def test_macro_validation_accepts_an_advanced_copy(tmp_path):
    baseline = DATA
    frame = pd.read_parquet(baseline)
    frame.index = pd.to_datetime(frame.index, utc=True)
    new_row = frame.iloc[[-1]].copy()
    new_row.index = [frame.index.max() + pd.Timedelta(days=1)]
    advanced = pd.concat([frame, new_row])
    path = tmp_path / "advanced.parquet"
    _write_copy(path, advanced)
    result = validate_macro_refresh(path, baseline)
    assert result.passed
    assert result.rows == len(advanced)
    assert result.last_date == advanced.index.max().date().isoformat()


def test_macro_validation_rejects_unchanged_without_a_reason(tmp_path):
    frame = pd.read_parquet(DATA)
    frame.index = pd.to_datetime(frame.index, utc=True)
    path = tmp_path / "unchanged.parquet"
    _write_copy(path, frame)
    result = validate_macro_refresh(path, DATA)
    assert not result.passed
    assert any("last date" in reason for reason in result.reasons)


def test_macro_validation_accepts_unchanged_with_an_explicit_reason(tmp_path):
    frame = pd.read_parquet(DATA)
    frame.index = pd.to_datetime(frame.index, utc=True)
    path = tmp_path / "unchanged.parquet"
    _write_copy(path, frame)
    result = validate_macro_refresh(
        path, DATA, allow_unchanged_reason="no new FRED observation this week"
    )
    assert result.passed


def test_macro_validation_rejects_schema_and_core_index_range(tmp_path):
    frame = pd.read_parquet(DATA)
    frame.index = pd.to_datetime(frame.index, utc=True)
    frame = frame.drop(columns=["core_index"])
    frame["core_index"] = 99.0
    path = tmp_path / "bad.parquet"
    _write_copy(path, frame)
    result = validate_macro_refresh(path, DATA)
    assert not result.passed
    assert any(check["id"] == "core_index_range" and check["status"] == "fail" for check in result.checks)


def test_service_loads_the_model_from_the_active_bundle(tmp_path, monkeypatch):
    runtime = tmp_path / "runtime"
    bundle = runtime / "bundles" / "testbundle"
    write_dataset(bundle, [], today=pd.Timestamp("2026-11-03").date())
    (bundle / "data").mkdir(parents=True, exist_ok=True)
    shutil.copyfile(DATA, bundle / "data" / "macro_regime_history.parquet")
    model, card = train_dataset(DATA)
    (bundle / "models").mkdir(parents=True, exist_ok=True)
    joblib.dump(model, bundle / "models" / "model.joblib")
    (bundle / "models" / "model_card.json").write_text(
        json.dumps(card), encoding="utf-8"
    )
    (bundle / "manifest.json").write_text(
        json.dumps({"bundle_version": "testbundle", "as_of": "2026-11-03"}),
        encoding="utf-8",
    )
    runtime.mkdir(parents=True, exist_ok=True)
    (runtime / "current").write_text("bundles/testbundle\n", encoding="utf-8")
    monkeypatch.setenv("EVENTS_RUNTIME_DIR", str(runtime))
    monkeypatch.setenv("HISTORICAL_EVENTS_SEED", str(tmp_path / "missing.json"))

    from regime.service import MacroRegimeService

    service = MacroRegimeService(artifact_path=DATA, meta_path=tmp_path / "missing.json")
    payload = service.forecast()
    assert payload["horizon_days"] == HORIZON_DAYS
    assert payload["target"] == TARGET_COLUMN
    assert payload["model_version"] == card["model_version"]
    assert 0.0 <= payload["disruptive_probability"] <= 1.0


def test_forecast_route_returns_503_without_a_model(tmp_path, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from regime.router import router

    monkeypatch.setenv("EVENTS_RUNTIME_DIR", str(tmp_path / "empty-runtime"))
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    client = TestClient(app)
    response = client.get("/api/v1/regime/forecast")
    assert response.status_code == 503
    assert "production forecast model" in response.json()["detail"]


def test_pipeline_marks_a_failed_macro_check_unpublishable(tmp_path):
    from datetime import date

    from astro_finance.events.pipeline import PipelineOptions, run_pipeline

    frame = pd.read_parquet(DATA)
    frame.index = pd.to_datetime(frame.index, utc=True)
    frame["core_index"] = 99.0
    bad = tmp_path / "bad-macro.parquet"
    _write_copy(bad, frame)
    result = run_pipeline(
        PipelineOptions(
            out_dir=tmp_path / "out",
            today=date(2026, 11, 3),
            requested_sources=(
                "historical_curated",
                "astronomy_computed",
                "culture_computed",
                "curated_upcoming",
            ),
            macro_parquet=bad,
            macro_allow_unchanged_reason="test reuses the baked artifact",
        )
    )
    assert result.publishable is False
    assert result.exit_code == 2
    report = json.loads(
        (result.bundle_dir / "quality_report.json").read_text("utf-8")
    )
    macro_gate = next(gate for gate in report["gates"] if gate["id"] == "macro_data")
    assert macro_gate["status"] == "fail"
    assert "core_index_range" in macro_gate["reason"]
    from astro_finance.events.bundle import validate_bundle_files

    assert validate_bundle_files(result.bundle_dir) == []


def test_write_dataset_copies_macro_and_model_payloads(tmp_path):
    from astro_finance.events.bundle import bundle_version_for, write_dataset

    model_dir = tmp_path / "model-input" / "models"
    model_dir.mkdir(parents=True)
    joblib.dump({"dummy": True}, model_dir / "model.joblib")
    (model_dir / "model_card.json").write_text(
        json.dumps({"model_version": "test", "files": {}}), encoding="utf-8"
    )
    (model_dir / "registry.json").write_text(
        json.dumps({"models": []}), encoding="utf-8"
    )
    (model_dir / "promotion.json").write_text(
        json.dumps({"status": "skipped"}), encoding="utf-8"
    )
    artifact = write_dataset(
        tmp_path / "bundle",
        [],
        today=pd.Timestamp("2026-11-03").date(),
        macro_parquet=DATA,
        model_dir=model_dir.parent,
    )
    assert (artifact.staging_dir / "data" / "macro_regime_history.parquet").is_file()
    assert (artifact.staging_dir / "models" / "model.joblib").is_file()
    assert artifact.bundle_version != bundle_version_for([])


def test_model_gate_rejects_a_directory_without_a_production_model(tmp_path):
    from astro_finance.events.model_bundle import model_gate

    result = model_gate(tmp_path / "empty")
    assert result is not None
    assert result.status == "fail"


def test_macro_validation_rejects_nan_explosion(tmp_path):
    frame = pd.read_parquet(DATA)
    frame.index = pd.to_datetime(frame.index, utc=True)
    frame["sp500_proxy"] = np.nan
    path = tmp_path / "nan.parquet"
    _write_copy(path, frame)
    result = validate_macro_refresh(
        path, DATA, allow_unchanged_reason="test reuses the baked artifact"
    )
    assert not result.passed
    assert any("nan_core_columns" in reason for reason in result.reasons)
