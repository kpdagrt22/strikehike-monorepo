"""Compile the multi-dimensional market/planetary model output into a 0-100 energy metric.

The compiler deliberately separates three things:
  1. raw inputs (volatility, planetary intensity, regime),
  2. normalized components (QuantileTransformer uniform, 0-100),
  3. the discrete polarity state and its human-readable description.

The uniform quantile transform is intentional. A linear MinMaxScaler compressed
the market distribution into the middle of the scale, so a crisis day such as
2008-09-15 only read as a mid-40s score. Quantile ranks preserve the top decile
(90-100) and keep an average day near 50. An exact outer-planet aspect (within
two degrees, excluding the permanently opposed Rahu-Ketu axis) applies a 17%
kinetic multiplier.

`determine_polarity` is the single classification entry point. The regime mapping
is based on the training history: in ``final_data_with_regimes.csv`` regime 2 has
the highest mean volatility and crash rate, regime 1 the lowest, and regime 0 sits
between them.

Calibration uses the model's daily output frame (12,014 rows, 1992-2025). The
separate 120-year crash atlas stores episodes, not daily inference vectors, so it
is not used to fit the scaler.
"""

from __future__ import annotations

from collections.abc import Mapping
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from itertools import combinations
from sklearn.preprocessing import QuantileTransformer

FAVORABLE = "Favorable/Positive"
DISRUPTIVE = "Disruptive/Negative"
NEUTRAL = "Neutral/Consolidating"

POLARITY_SHORT = {
    FAVORABLE: "Favorable",
    DISRUPTIVE: "Disruptive",
    NEUTRAL: "Neutral",
}

DESCRIPTIONS = {
    FAVORABLE: (
        "Low kinetic energy, constructive historical conditions, and a "
        "supportive volatility regime."
    ),
    DISRUPTIVE: (
        "High kinetic energy, historical correlation with sudden market shifts."
    ),
    NEUTRAL: (
        "Moderate kinetic energy, mixed historical signals, and a consolidating "
        "volatility regime."
    ),
}

# Malefic interaction weights (sum = 1.0). Rahu-Ketu is excluded because the nodal
# axis is always active in this dataset and therefore carries no discriminating signal.
MALEFIC_INTENSITY_WEIGHTS = {
    "Malefic_Mars_Saturn_Interaction": 0.30,
    "Malefic_Mars_Rahu_Interaction": 0.20,
    "Malefic_Mars_Ketu_Interaction": 0.20,
    "Malefic_Saturn_Rahu_Interaction": 0.15,
    "Malefic_Saturn_Ketu_Interaction": 0.15,
}

VOLATILITY_WEIGHT = 0.85
INTENSITY_WEIGHT = 0.15
VOLATILITY_CLIP_QUANTILES = (0.01, 0.99)
EXACT_ASPECT_ORB = 2.0
EXACT_ASPECT_ANGLES = (0.0, 90.0, 180.0)
ASPECT_MULTIPLIER = 1.17
OUTER_BODIES = ("Jupiter", "Saturn", "Rahu", "Ketu")

BODY_NAMES = [
    "Sun",
    "Moon",
    "Mars",
    "Mercury",
    "Jupiter",
    "Venus",
    "Saturn",
    "Rahu",
    "Ketu",
]

RASHI_NAMES = [
    "Aries",
    "Taurus",
    "Gemini",
    "Cancer",
    "Leo",
    "Virgo",
    "Libra",
    "Scorpio",
    "Sagittarius",
    "Capricorn",
    "Aquarius",
    "Pisces",
]

NAKSHATRA_NAMES = [
    "Ashwini",
    "Bharani",
    "Krittika",
    "Rohini",
    "Mrigashira",
    "Ardra",
    "Punarvasu",
    "Pushya",
    "Ashlesha",
    "Magha",
    "Purva Phalguni",
    "Uttara Phalguni",
    "Hasta",
    "Chitra",
    "Swati",
    "Vishakha",
    "Anuradha",
    "Jyeshtha",
    "Mula",
    "Purva Ashadha",
    "Uttara Ashadha",
    "Shravana",
    "Dhanishta",
    "Shatabhisha",
    "Purva Bhadrapada",
    "Uttara Bhadrapada",
    "Revati",
]


def rashi_nakshatra_pada(degree: float) -> dict[str, Any]:
    """Return the sidereal rashi, nakshatra and pada for an ecliptic degree."""
    normalized = float(degree) % 360.0
    rashi_index = int(normalized / 30.0) % 12

    nakshatra_raw = normalized / (360.0 / 27.0)
    nakshatra_index = int(nakshatra_raw) % 27
    pada = int((nakshatra_raw - int(nakshatra_raw)) * 4) + 1

    return {
        "rashi": RASHI_NAMES[rashi_index],
        "nakshatra": NAKSHATRA_NAMES[nakshatra_index],
        "pada": pada,
    }


def _as_float(value: Any, default: float = 0.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    return number if np.isfinite(number) else default


def _optional_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if np.isfinite(number) else None


def _regime_kind(regime: Any) -> str | None:
    """Map the model's regime value to a polarity family.

    The CSV's regime 2 is the high-volatility/high-crash cluster, regime 1 is the
    low-volatility cluster, and regime 0 is the mixed middle. String aliases are
    accepted for callers that pass labels instead of integers.
    """
    if regime is None:
        return None

    if isinstance(regime, str):
        key = regime.strip().lower()
        if key in {"2", "bear", "bear_flow", "disruptive", DISRUPTIVE.lower()}:
            return "disruptive"
        if key in {"1", "bull", "bull_flow", "favorable", FAVORABLE.lower()}:
            return "favorable"
        if key in {
            "0",
            "stagnant",
            "consolidation",
            "neutral",
            NEUTRAL.lower(),
        }:
            return "neutral"
        return None

    try:
        value = int(regime)
    except (TypeError, ValueError):
        return None

    return {2: "disruptive", 1: "favorable", 0: "neutral"}.get(value)


def planetary_intensity_from_row(row: Mapping[str, Any]) -> float:
    """Weighted sum of active malefic interactions, clipped to 0-1."""
    intensity = sum(
        _as_float(row.get(column, 0.0)) * weight
        for column, weight in MALEFIC_INTENSITY_WEIGHTS.items()
    )
    return float(np.clip(intensity, 0.0, 1.0))


def _angular_distance(longitude_a: float, longitude_b: float) -> float:
    return abs((longitude_a - longitude_b + 180.0) % 360.0 - 180.0)


def outer_planet_aspect_strength(row: Mapping[str, Any]) -> float:
    """Return 1.0 when an exact outer-planet hard aspect exists.

    Rahu-Ketu is excluded because the lunar nodes are permanently opposed and
    would otherwise apply the multiplier on every single day. The remaining
    outer-planet pairs are Jupiter/Saturn/Rahu/Ketu.
    """
    degrees = {}
    for body in OUTER_BODIES:
        value = _optional_float(row.get(f"{body}_Degree"))
        if value is not None:
            degrees[body] = value

    for first, second in combinations(OUTER_BODIES, 2):
        if {first, second} == {"Rahu", "Ketu"}:
            continue
        if first not in degrees or second not in degrees:
            continue
        separation = _angular_distance(degrees[first], degrees[second])
        if any(abs(separation - angle) <= EXACT_ASPECT_ORB for angle in EXACT_ASPECT_ANGLES):
            return 1.0
    return 0.0


def determine_polarity(model_weights: Mapping[str, Any]) -> str:
    """Return one of the three canonical polarity states.

    ``model_weights`` may contain:
      volatility, intensity, regime, crash_probability, trend

    Only intensity and regime are required for the core rules; the optional
    crash probability and trend let a live inference path sharpen the decision.
    """
    intensity = float(
        np.clip(_as_float(model_weights.get("intensity", 0.0)), 0.0, 1.0)
    )
    crash = _optional_float(model_weights.get("crash_probability"))
    trend = _optional_float(model_weights.get("trend"))
    regime = _regime_kind(model_weights.get("regime"))

    if crash is not None and crash >= 0.55:
        return DISRUPTIVE
    if trend is not None and trend <= -0.25:
        return DISRUPTIVE
    if regime == "disruptive":
        return DISRUPTIVE
    if intensity >= 0.75:
        return DISRUPTIVE

    if crash is not None and crash <= 0.20 and intensity <= 0.45:
        return FAVORABLE
    if trend is not None and trend >= 0.25 and intensity <= 0.55:
        return FAVORABLE
    if regime == "favorable":
        return FAVORABLE
    if regime == "neutral":
        return NEUTRAL

    if intensity <= 0.25:
        return FAVORABLE
    return NEUTRAL


class EnergyMetricCompiler:
    """Fit a uniform quantile calibration and compile a 0-100 score."""

    def __init__(
        self,
        *,
        scaler: QuantileTransformer | None = None,
        volatility_bounds: tuple[float, float] | None = None,
    ) -> None:
        self.scaler = scaler
        self.volatility_bounds = volatility_bounds
        self._fitted = scaler is not None

    @classmethod
    def from_dataframe(cls, frame: pd.DataFrame) -> "EnergyMetricCompiler":
        """Calibrate on the model's historical daily output."""
        required = ["Volatility", *MALEFIC_INTENSITY_WEIGHTS]
        missing = [column for column in required if column not in frame.columns]
        if missing:
            raise ValueError(
                "Cannot calibrate energy metric; missing columns: "
                + ", ".join(missing)
            )

        data = frame.dropna(subset=["Volatility"]).copy()
        if data.empty:
            raise ValueError("Cannot calibrate energy metric on an empty frame.")

        volatility = data["Volatility"].astype(float)
        lower, upper = volatility.quantile(VOLATILITY_CLIP_QUANTILES)
        lower = float(lower)
        upper = float(upper)

        if not np.isfinite(lower) or not np.isfinite(upper) or upper <= lower:
            lower = float(volatility.min())
            upper = float(volatility.max())
        if upper <= lower:
            upper = lower + 1e-12

        intensity = pd.Series(0.0, index=data.index, dtype=float)
        for column, weight in MALEFIC_INTENSITY_WEIGHTS.items():
            intensity += data[column].astype(float).fillna(0.0) * weight
        intensity = intensity.clip(0.0, 1.0)

        calibration = np.column_stack(
            [
                volatility.clip(lower, upper).to_numpy(dtype=float),
                intensity.to_numpy(dtype=float),
            ]
        )

        scaler = QuantileTransformer(
            n_quantiles=min(1000, max(2, len(calibration))),
            output_distribution="uniform",
            subsample=min(len(calibration), 100_000),
            random_state=42,
        ).fit(calibration)
        return cls(
            scaler=scaler,
            volatility_bounds=(lower, upper),
        )

    @classmethod
    def from_csv(cls, path: str | Path) -> "EnergyMetricCompiler":
        frame = pd.read_csv(path, index_col=0, parse_dates=True)
        return cls.from_dataframe(frame)

    def compile(self, model_weights: Mapping[str, Any]) -> dict[str, Any]:
        """Normalize the inputs and return the canonical energy object."""
        if not self._fitted or self.volatility_bounds is None:
            raise RuntimeError(
                "EnergyMetricCompiler is not calibrated. "
                "Use from_dataframe(), from_csv(), or pass a fitted scaler."
            )

        lower, upper = self.volatility_bounds
        raw_volatility = _as_float(model_weights.get("volatility", 0.0))
        raw_intensity = _as_float(model_weights.get("intensity", 0.0))
        volatility = float(np.clip(raw_volatility, lower, upper))
        intensity = float(np.clip(raw_intensity, 0.0, 1.0))

        scaled = self.scaler.transform([[volatility, intensity]])[0]
        weighted_score = (
            100.0
            * (
                VOLATILITY_WEIGHT * float(scaled[0])
                + INTENSITY_WEIGHT * float(scaled[1])
            )
        )
        # Preserve the stated top-decile contract: a day in the top 10% of
        # either volatility or intensity cannot be suppressed by a weak
        # secondary component.
        top_component = max(float(scaled[0]), float(scaled[1])) * 100.0
        base_score = int(
            np.clip(
                round(max(weighted_score, top_component if top_component >= 90 else 0.0)),
                0,
                100,
            )
        )
        aspect_strength = 1.0 if _as_float(
            model_weights.get("aspect_strength", 0.0)
        ) >= 0.5 else 0.0
        score = int(
            np.clip(
                round(base_score * (ASPECT_MULTIPLIER if aspect_strength else 1.0)),
                0,
                100,
            )
        )

        polarity = determine_polarity(
            {**dict(model_weights), "volatility": volatility, "intensity": intensity}
        )

        return {
            "score": score,
            "base_score": base_score,
            "polarity": polarity,
            "polarity_short": POLARITY_SHORT[polarity],
            "description": DESCRIPTIONS[polarity],
            "components": {
                "volatility": round(float(scaled[0]) * 100.0, 2),
                "intensity": round(float(scaled[1]) * 100.0, 2),
            },
            "weights": {
                "volatility": VOLATILITY_WEIGHT,
                "intensity": INTENSITY_WEIGHT,
            },
            "aspect": {
                "exact_outer_hard_aspect": bool(aspect_strength),
                "multiplier": ASPECT_MULTIPLIER if aspect_strength else 1.0,
            },
            "calibration": "quantile_uniform",
            "inputs": {
                "volatility": round(raw_volatility, 6),
                "intensity": round(raw_intensity, 4),
                "regime": model_weights.get("regime"),
            },
        }

    def compile_from_row(self, row: Mapping[str, Any]) -> dict[str, Any]:
        """Convenience path for a row from the historical feature frame."""
        regime = row.get("Market_Regime")
        if pd.notna(regime):
            try:
                regime = int(regime)
            except (TypeError, ValueError):
                pass

        return self.compile(
            {
                "volatility": row.get("Volatility", 0.0),
                "intensity": planetary_intensity_from_row(row),
                "regime": regime,
                "aspect_strength": outer_planet_aspect_strength(row),
            }
        )


__all__ = [
    "BODY_NAMES",
    "DISRUPTIVE",
    "FAVORABLE",
    "NEUTRAL",
    "EnergyMetricCompiler",
    "determine_polarity",
    "outer_planet_aspect_strength",
    "planetary_intensity_from_row",
    "rashi_nakshatra_pada",
]
