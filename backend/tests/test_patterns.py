from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from regime.patterns import (  # noqa: E402
    PATTERN_WINDOW_DAYS,
    build_patterns_payload,
)
from regime.schemas import PatternsResponse  # noqa: E402


def _pattern_frame() -> pd.DataFrame:
    index = pd.date_range("1899-01-01", "2020-12-31", freq="D", tz="UTC")
    steps = np.arange(len(index), dtype=float)
    frame = pd.DataFrame(index=index)

    # A smooth long-run equity path with a visible boom and drawdown so the
    # forward peak/drawdown fields are exercised, not just the happy path.
    frame["sp500_proxy"] = 100.0 * np.exp(steps / 9000.0) * (
        1.0 + 0.08 * np.sin(steps / 240.0)
    )
    frame["sp500_proxy_source"] = "TEST_EQUITY"
    frame["nber_phase"] = "expansion"
    frame["core_index"] = 12.0
    frame["core_index_bucket"] = "calm_bullish"

    nifty = pd.Series(np.nan, index=index)
    nifty.loc["2008-01-01":] = 5000.0 * np.exp(
        np.arange(len(nifty.loc["2008-01-01":]), dtype=float) / 4500.0
    )
    frame["nifty_proxy"] = nifty
    frame["nifty_proxy_source"] = pd.Series(
        "TEST_NIFTY", index=index
    ).where(nifty.notna())
    return frame


def test_sp500_uses_exact_120_year_date_and_one_year_forward():
    payload = build_patterns_payload(
        _pattern_frame(),
        today="2020-06-30",
        asset="sp500",
    )

    assert payload["as_of"] == "2020-06-30"
    assert payload["historical_date"] == "1900-06-30"
    assert payload["requested_historical_date"] == "1900-06-30"
    assert payload["mirror_fallback"] is False
    assert payload["mirror_note"] is None
    assert payload["forward"]["start"] == "1900-06-30"
    assert payload["forward"]["end"] == "1901-06-30"
    assert payload["forward"]["asset"] == "S&P 500 / long-run equity proxy"
    assert len(payload["current"]["series"]) == PATTERN_WINDOW_DAYS
    assert len(payload["historical"]["series"]) == PATTERN_WINDOW_DAYS
    assert 0.0 <= payload["similarity_percentage"] <= 100.0
    assert payload["correlation"] >= 0.0
    assert payload["forward"]["peak"]["value"] > 0
    assert payload["forward"]["drawdown_peak"]["value"] > 0
    assert payload["forward"]["max_drawdown_pct"] <= 0
    validated = PatternsResponse(**payload)
    assert validated.forward.drawdown_peak.value > 0


def test_short_history_asset_uses_earliest_complete_mirror():
    payload = build_patterns_payload(
        _pattern_frame(),
        today="2020-06-30",
        asset="nifty",
    )

    expected_mirror = (
        pd.Timestamp("2008-01-01") + pd.Timedelta(days=PATTERN_WINDOW_DAYS)
    )
    assert payload["historical_date"] == expected_mirror.date().isoformat()
    assert payload["requested_historical_date"] == "1900-06-30"
    assert payload["mirror_fallback"] is True
    assert "history begins" in payload["mirror_note"]
    assert payload["forward"]["start"] == payload["historical_date"]
    assert payload["forward"]["end"] == "2009-12-31"
    assert payload["current"]["asset"] == "Nifty 50 — India"
    assert any(event["date"] == "2009-01-07" for event in payload["events"])
    assert PatternsResponse(**payload).mirror_fallback is True


def test_unknown_pattern_asset_raises_value_error():
    with pytest.raises(ValueError, match="Unknown pattern asset"):
        build_patterns_payload(
            _pattern_frame(),
            today="2020-06-30",
            asset="not-an-asset",
        )
