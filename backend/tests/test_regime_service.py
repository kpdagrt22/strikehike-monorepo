from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from regime.service import MacroRegimeService  # noqa: E402


def _write_artifact(tmp_path: Path) -> tuple[Path, Path]:
    index = pd.date_range("2019-01-01", "2020-12-31", freq="D", tz="UTC")
    frame = pd.DataFrame(index=index)
    frame["macro_strength"] = 55.0
    frame["macro_strength_coverage"] = 1.0
    frame["sp500_proxy"] = 3000.0
    frame["sp500_proxy_source"] = "TEST"
    frame["FEDFUNDS"] = 2.0
    frame["T10Y2Y"] = 0.5
    frame["nber_recession"] = 0
    frame["nber_phase"] = "expansion"
    frame["nber_episode"] = 0
    frame.loc["2020-03-01":"2020-04-30", "nber_recession"] = 1
    frame.loc[frame["nber_recession"] == 1, "nber_phase"] = "recession"
    frame.loc[frame["nber_recession"] == 1, "nber_episode"] = 1

    # A deliberately simple regime cycle for the runs/transition tests.
    frame["regime_state"] = "neutral"
    frame.loc["2019-01-01":"2019-06-30", "regime_state"] = "favorable"
    frame.loc["2019-07-01":"2019-09-30", "regime_state"] = "neutral"
    frame.loc["2019-10-01":"2019-12-31", "regime_state"] = "disruptive"
    frame.loc["2020-01-01":"2020-06-30", "regime_state"] = "favorable"
    frame.loc["2020-07-01":"2020-09-30", "regime_state"] = "neutral"
    frame.loc["2020-10-01":"2020-12-31", "regime_state"] = "disruptive"
    frame["1y_volatility_percentile"] = 50.0
    frame["volatility_1y"] = 12.0
    frame["drawdown_1y"] = -5.0
    frame["core_index"] = 12.34
    frame["core_index_composite"] = 62.34
    frame["core_index_bucket"] = "calm_bullish"
    frame["macro_score"] = 55.0
    frame["credit_score"] = 70.0
    frame["core_volatility_score"] = 60.0
    frame["core_momentum_score"] = 50.0
    frame["hy_oas"] = 3.25
    frame["btc_proxy"] = np.linspace(7000.0, 29000.0, len(index))
    frame["btc_proxy_source"] = "TEST_BTC"
    frame["btc_volatility_1y"] = 55.0
    frame["btc_drawdown_1y"] = -10.0
    frame["btc_1y_volatility_percentile"] = 60.0
    frame["fed_cross"] = np.linspace(-0.5, 0.5, len(index))
    frame["curve_cross"] = np.linspace(0.4, -0.4, len(index))
    frame["sahm_alert"] = False
    frame.loc["2020-03-01":"2020-04-30", "sahm_alert"] = True

    artifact = tmp_path / "macro_regime_history.parquet"
    frame.to_parquet(artifact, engine="pyarrow", compression="snappy")

    metadata = {
        "generated_at": "2026-01-01T00:00:00+00:00",
        "data_version": "test-version",
        "strength": {
            "version": "v1-ma-crossover",
            "weights": {"fed_score": 0.55, "curve_score": 0.45},
            "latest": {
                "date": "2020-12-31",
                "score": 55.0,
                "label": "neutral",
                "coverage": 1.0,
            },
        },
        "proxy": {
            "sources": [
                {
                    "source": "TEST",
                    "start": "2019-01-01",
                    "end": "2020-12-31",
                    "observations": len(frame),
                }
            ]
        },
        "core_index": {
            "version": "core-index-v1",
            "weights": {"macro": 0.4, "volatility": 0.3, "momentum": 0.3},
            "latest": {
                "date": "2020-12-31",
                "score": 12.34,
                "bucket": "calm_bullish",
                "composite": 62.34,
            },
        },
        "nber": {"source": "USREC"},
        "source": {"transport": "test"},
        "notes": ["Synthetic fixture."],
    }
    meta_path = tmp_path / "macro_regime_history.meta.json"
    meta_path.write_text(json.dumps(metadata), encoding="utf-8")
    return artifact, meta_path


def test_macro_history_returns_timeline_and_crash_windows(tmp_path):
    artifact, meta_path = _write_artifact(tmp_path)
    service = MacroRegimeService(artifact_path=artifact, meta_path=meta_path)

    payload = service.macro_history(resolution="weekly")

    assert payload["resolution"] == "weekly"
    assert payload["point_count"] == len(payload["timeline"])
    assert payload["point_count"] > 0
    assert payload["coverage"]["start"] == "2019-01-01"
    assert payload["coverage"]["end"] == "2020-12-31"
    assert payload["meta"]["data_version"] == "test-version"
    assert payload["meta"]["latest_strength"]["score"] == 55.0
    assert payload["timeline"][0]["proxy_source"] == "TEST"
    assert payload["timeline"][0]["regime_state"] == "favorable"
    assert payload["timeline"][0]["1y_volatility_percentile"] == 50.0
    assert payload["timeline"][0]["core_index"] == 12.34
    assert payload["timeline"][0]["core_index_bucket"] == "calm_bullish"
    assert payload["timeline"][0]["btc_proxy"] is not None
    assert payload["meta"]["latest_core_index"]["score"] == 12.34
    assert payload["meta"]["core_index_version"] == "core-index-v1"

    monthly = service.macro_history(resolution="monthly")
    assert monthly["resolution"] == "monthly"
    assert 0 < monthly["point_count"] < payload["point_count"]

    assert len(payload["crashes"]) == 1
    crash = payload["crashes"][0]
    assert crash["name"] == "COVID-19 shock"
    assert crash["start"] == "2020-02-01"
    assert crash["within_coverage"] is True
    assert crash["indicator_start"] == "2020-03-01"
    assert crash["pre_crash_indicators"]["3m"]["as_of"] == "2019-11-01"
    assert crash["pre_crash_indicators"]["6m"]["as_of"] == "2019-08-01"
    assert crash["pre_crash_indicators"]["3m"]["fed_funds"] == 2.0
    assert crash["pre_crash_indicators"]["3m"]["core_index"] == 12.34


def test_regime_runs_returns_transition_matrix_and_durations(tmp_path):
    artifact, meta_path = _write_artifact(tmp_path)
    service = MacroRegimeService(artifact_path=artifact, meta_path=meta_path)

    payload = service.regime_runs()

    assert payload["resolution"] == "monthly"
    assert payload["states"] == ["favorable", "neutral", "disruptive"]
    assert payload["sample"]["observations"] == 24
    assert len(payload["runs"]) == 6

    first = payload["runs"][0]
    assert first["state"] == "favorable"
    assert first["start"] == "2019-01-31"
    assert first["end"] == "2019-06-30"
    assert first["duration_months"] == 6
    assert first["start_volatility_percentile"] == 50.0
    assert first["end_volatility_percentile"] == 50.0
    assert first["median_volatility_percentile"] == 50.0

    transitions = payload["transitions"]
    assert transitions["counts"]["favorable"]["neutral"] == 2
    assert transitions["probabilities"]["favorable"]["neutral"] == pytest.approx(
        2 / 12, abs=1e-4
    )
    assert transitions["median_duration_months"]["favorable"] == 6.0
    assert transitions["median_duration_months"]["neutral"] == 3.0
    assert transitions["median_duration_months"]["disruptive"] == 3.0
    assert transitions["run_counts"] == {
        "favorable": 2,
        "neutral": 2,
        "disruptive": 2,
    }


def test_daily_resolution_for_short_window(tmp_path):
    artifact, meta_path = _write_artifact(tmp_path)
    service = MacroRegimeService(artifact_path=artifact, meta_path=meta_path)

    payload = service.macro_history(
        resolution="daily",
        start="2020-01-01",
        end="2020-06-30",
    )
    assert payload["resolution"] == "daily"
    assert payload["point_count"] == len(payload["timeline"])
    assert payload["range"]["start"] == "2020-01-01"
    assert payload["range"]["end"] == "2020-06-30"


def test_forecast_returns_30_day_disruptive_probability(tmp_path):
    artifact, meta_path = _write_artifact(tmp_path)
    service = MacroRegimeService(artifact_path=artifact, meta_path=meta_path)

    payload = service.forecast()

    assert payload["as_of"] == "2020-12-31"
    assert payload["horizon_days"] == 30
    assert payload["model"] == "logistic_regression_v2"
    assert payload["features"] == ["fed_cross", "curve_cross", "sahm_alert"]
    assert payload["training"]["observations"] > 250
    assert 0.0 <= payload["disruptive_probability"] <= 1.0
    assert 0.0 <= payload["risk_pct"] <= 100.0
    assert payload["current"]["as_of"] == "2020-12-31"
    assert payload["current"]["features"]["sahm_alert"] is False
    assert service.forecast() is payload


def test_invalid_ranges_raise_value_error(tmp_path):
    artifact, meta_path = _write_artifact(tmp_path)
    service = MacroRegimeService(artifact_path=artifact, meta_path=meta_path)

    with pytest.raises(ValueError):
        service.macro_history(start="2021-01-01", end="2020-01-01")
    with pytest.raises(ValueError):
        service.macro_history(start="2030-01-01", end="2030-12-31")
    with pytest.raises(ValueError):
        service.regime_runs(start="2030-01-01", end="2030-12-31")


def test_crypto_milestones_join_market_stats_and_core_index(tmp_path):
    artifact, meta_path = _write_artifact(tmp_path)
    service = MacroRegimeService(
        artifact_path=artifact,
        meta_path=meta_path,
        crypto_milestones_path=tmp_path / "missing_crypto_milestones.json",
    )

    payload = service.crypto_milestones()

    assert payload["version"] == "crypto-milestones-v1"
    assert len(payload["events"]) == 7
    assert payload["coverage"]["start"] == "2019-01-01"
    assert payload["coverage"]["years"] > 1
    covid = next(
        event for event in payload["events"] if event["id"] == "covid-shock"
    )
    assert covid["assets"]["bitcoin"]["available"] is True
    assert covid["assets"]["bitcoin"]["start_value"] > 0
    assert covid["assets"]["bitcoin"]["end_value"] > 0
    assert covid["assets"]["sp500"]["available"] is True
    assert covid["core_index"]["at_peak"] == 12.34
    assert covid["core_index"]["at_trough"] == 12.34
    assert covid["core_index"]["at_peak_bucket"] == "calm_bullish"
