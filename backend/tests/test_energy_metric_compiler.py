import pandas as pd

from astro_finance.energy_metric_compiler import (
    DISRUPTIVE,
    FAVORABLE,
    NEUTRAL,
    EnergyMetricCompiler,
    determine_polarity,
    planetary_intensity_from_row,
)


def _frame() -> pd.DataFrame:
    return pd.DataFrame(
        {
            "Volatility": [0.002, 0.004, 0.008, 0.016, 0.030],
            "Market_Regime": [0, 1, 0, 2, 2],
            "Malefic_Mars_Saturn_Interaction": [0, 1, 0, 1, 0],
            "Malefic_Mars_Rahu_Interaction": [0, 0, 1, 1, 0],
            "Malefic_Mars_Ketu_Interaction": [0, 0, 0, 1, 0],
            "Malefic_Saturn_Rahu_Interaction": [0, 0, 0, 0, 1],
            "Malefic_Saturn_Ketu_Interaction": [0, 0, 0, 0, 1],
        }
    )


def test_polarity_states_are_exact():
    assert determine_polarity({"regime": 2}) == DISRUPTIVE
    assert determine_polarity({"regime": 1, "intensity": 0.2}) == FAVORABLE
    assert determine_polarity({"regime": 0, "intensity": 0.2}) == NEUTRAL
    assert determine_polarity({"crash_probability": 0.6}) == DISRUPTIVE
    assert determine_polarity({"crash_probability": 0.1, "intensity": 0.2}) == FAVORABLE


def test_intensity_weights_are_bounded():
    empty = {column: 0 for column in _frame().columns if column.startswith("Malefic_")}
    assert planetary_intensity_from_row(empty) == 0.0

    full = {column: 1 for column in _frame().columns if column.startswith("Malefic_")}
    assert planetary_intensity_from_row(full) == 1.0


def test_compiler_returns_int_score_and_monotonic_energy():
    compiler = EnergyMetricCompiler.from_dataframe(_frame())

    low = compiler.compile(
        {"volatility": 0.002, "intensity": 0.0, "regime": 1}
    )
    high = compiler.compile(
        {"volatility": 0.030, "intensity": 1.0, "regime": 2}
    )

    assert isinstance(low["score"], int)
    assert isinstance(high["score"], int)
    assert 0 <= low["score"] <= 100
    assert 0 <= high["score"] <= 100
    assert high["score"] >= low["score"]
    assert low["polarity"] == FAVORABLE
    assert high["polarity"] == DISRUPTIVE
    assert set(low) >= {"score", "polarity", "polarity_short", "description"}


def test_compile_from_row_uses_volatility_and_malefics():
    frame = _frame()
    compiler = EnergyMetricCompiler.from_dataframe(frame)
    energy = compiler.compile_from_row(frame.iloc[-1])

    assert energy["score"] >= 85
    assert energy["polarity"] == DISRUPTIVE
    assert energy["polarity_short"] == "Disruptive"
