"""Pydantic response models for the Regime Intelligence API."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class TimelinePoint(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    date: str
    strength: float | None = None
    regime_state: str | None = None
    volatility_1y: float | None = None
    drawdown_1y: float | None = None
    volatility_percentile_1y: float | None = Field(
        default=None,
        alias="1y_volatility_percentile",
    )
    sp500_proxy: float | None = None
    proxy_source: str | None = None
    usrec: int | None = None
    phase: str | None = None
    nber_episode: int | None = None
    fed_funds: float | None = None
    t10y2y: float | None = None
    strength_coverage: float | None = None


class PreCrashState(BaseModel):
    as_of: str | None = None
    months_prior: int
    t10y2y: float | None = None
    fed_funds: float | None = None
    curve_inverted: bool | None = None
    macro_strength: float | None = None
    sp500_proxy: float | None = None
    phase: str | None = None


class PreCrashIndicators(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    three_months: PreCrashState = Field(alias="3m")
    six_months: PreCrashState = Field(alias="6m")


class ZoomWindow(BaseModel):
    start: str
    end: str


class Crash(BaseModel):
    id: str
    name: str
    type: str
    start: str
    end: str
    start_month: str
    end_month: str
    indicator_start: str
    indicator_end: str
    duration_days: int
    date_precision: str
    ongoing: bool
    within_coverage: bool
    zoom_window: ZoomWindow
    pre_crash_indicators: PreCrashIndicators


class Coverage(BaseModel):
    start: str
    end: str
    years: float


class ReturnedRange(BaseModel):
    start: str
    end: str


class ProxySource(BaseModel):
    source: str
    start: str
    end: str
    observations: int


class LatestStrength(BaseModel):
    date: str
    score: float | None = None
    label: str | None = None
    regime_state: str | None = None
    coverage: float | None = None


class ResponseMeta(BaseModel):
    generated_at: str | None = None
    data_version: str | None = None
    strength_version: str
    feature_version: str | None = None
    strength_weights: dict[str, float]
    regime_thresholds: dict[str, float] | None = None
    latest_strength: LatestStrength | None = None
    proxy_sources: list[ProxySource]
    nber_source: str
    transport: str | None = None
    notes: list[str]


class MacroHistoryResponse(BaseModel):
    as_of: str
    coverage: Coverage
    range: ReturnedRange
    resolution: str
    point_count: int
    timeline: list[TimelinePoint]
    crashes: list[Crash]
    meta: ResponseMeta


class RegimeRun(BaseModel):
    state: str
    start: str
    end: str
    duration_days: int
    duration_months: int
    start_volatility_percentile: float | None = None
    end_volatility_percentile: float | None = None
    median_volatility_percentile: float | None = None


class RegimeSample(BaseModel):
    start: str
    end: str
    observations: int


class RegimeTransitions(BaseModel):
    states: list[str]
    counts: dict[str, dict[str, int]]
    probabilities: dict[str, dict[str, float | None]]
    median_duration_months: dict[str, float | None]
    run_counts: dict[str, int]
    sample_start: str
    sample_end: str
    sample_observations: int


class RegimeRunsResponse(BaseModel):
    as_of: str
    coverage: Coverage
    resolution: str
    states: list[str]
    sample: RegimeSample
    runs: list[RegimeRun]
    transitions: RegimeTransitions
    meta: ResponseMeta
