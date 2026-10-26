from __future__ import annotations

import json
import sys
from pathlib import Path

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
    frame.loc["2020-03-01":"2020-04-30", "nber_recession"] = 1
    frame.loc[frame["nber_recession"] == 1, "nber_phase"] = "recession"

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


def test_invalid_ranges_raise_value_error(tmp_path):
    artifact, meta_path = _write_artifact(tmp_path)
    service = MacroRegimeService(artifact_path=artifact, meta_path=meta_path)

    with pytest.raises(ValueError):
        service.macro_history(start="2021-01-01", end="2020-01-01")
    with pytest.raises(ValueError):
        service.macro_history(start="2030-01-01", end="2030-12-31")
