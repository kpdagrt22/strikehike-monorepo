"""Pydantic response models for the Regime Intelligence API."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class TimelinePoint(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    date: str
    strength: float | None = None
    regime_state: str | None = None
    core_index: float | None = None
    core_index_composite: float | None = None
    core_index_bucket: str | None = None
    # Core Index v2: the class of the decline under way (none, correction,
    # bear, crash) and the warning flag. Null before the first scored Friday.
    core_index_severity: str | None = None
    core_index_warning: bool | None = None
    # Trend warning: Friday S&P close below its 40-Friday average, a separate
    # and more sensitive flag. Null until 40 Friday closes exist (1928-09-28).
    core_index_trend_warning: bool | None = None
    macro_score: float | None = None
    credit_score: float | None = None
    core_volatility_score: float | None = None
    core_momentum_score: float | None = None
    hy_oas: float | None = None
    atr_pct: float | None = None
    bollinger_width: float | None = None
    rsi_14: float | None = None
    macd: float | None = None
    macd_hist: float | None = None
    volatility_1y: float | None = None
    drawdown_1y: float | None = None
    volatility_percentile_1y: float | None = Field(
        default=None,
        alias="1y_volatility_percentile",
    )
    sp500_proxy: float | None = None
    proxy_source: str | None = None
    gold_proxy: float | None = None
    gold_proxy_source: str | None = None
    gold_volatility_1y: float | None = None
    gold_drawdown_1y: float | None = None
    gold_volatility_percentile_1y: float | None = Field(
        default=None,
        alias="gold_1y_volatility_percentile",
    )
    bond_proxy: float | None = None
    bond_proxy_source: str | None = None
    bond_volatility_1y: float | None = None
    bond_drawdown_1y: float | None = None
    bond_volatility_percentile_1y: float | None = Field(
        default=None,
        alias="bond_1y_volatility_percentile",
    )
    btc_proxy: float | None = None
    btc_proxy_source: str | None = None
    btc_volatility_1y: float | None = None
    btc_drawdown_1y: float | None = None
    btc_volatility_percentile_1y: float | None = Field(
        default=None,
        alias="btc_1y_volatility_percentile",
    )
    nifty_proxy: float | None = None
    nifty_proxy_source: str | None = None
    nifty_volatility_1y: float | None = None
    nifty_drawdown_1y: float | None = None
    nifty_volatility_percentile_1y: float | None = Field(
        default=None,
        alias="nifty_1y_volatility_percentile",
    )
    dxy_proxy: float | None = None
    dxy_proxy_source: str | None = None
    dxy_volatility_1y: float | None = None
    dxy_drawdown_1y: float | None = None
    dxy_volatility_percentile_1y: float | None = Field(
        default=None,
        alias="dxy_1y_volatility_percentile",
    )
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
    core_index: float | None = None
    core_index_bucket: str | None = None
    core_index_severity: str | None = None
    core_index_warning: bool | None = None
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
    bucket: str | None = None
    regime_state: str | None = None
    coverage: float | None = None


class LatestCoreIndex(LatestStrength):
    composite: float | None = None
    severity: str | None = None
    warning: bool | None = None
    trend_warning: bool | None = None
    # The Friday whose close decided the value carried on ``date``.
    signal_date: str | None = None


class ResponseMeta(BaseModel):
    generated_at: str | None = None
    data_version: str | None = None
    strength_version: str
    feature_version: str | None = None
    strength_weights: dict[str, float]
    regime_thresholds: dict[str, float] | None = None
    latest_strength: LatestStrength | None = None
    core_index_version: str | None = None
    core_index_weights: dict[str, float] | None = None
    core_index_buckets: dict[str, str] | None = None
    core_index_severities: list[str] | None = None
    core_index_first_scored: str | None = None
    core_index_cadence: str | None = None
    # The trend warning's definition and measured record (misses and false
    # alarms included), as stored in the artifact metadata.
    core_index_trend_warning: dict[str, Any] | None = None
    latest_core_index: LatestCoreIndex | None = None
    proxy_sources: list[ProxySource]
    nber_source: str
    transport: str | None = None
    assets: dict[str, dict[str, Any]] | None = None
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


class ForecastTraining(BaseModel):
    start: str
    end: str
    observations: int
    disruptive_base_rate: float


class ForecastCurrent(BaseModel):
    as_of: str
    regime_state: str | None = None
    macro_strength: float | None = None
    features: dict[str, float | bool | None]


class ForecastResponse(BaseModel):
    as_of: str
    horizon_days: int
    model: str
    features: list[str]
    training: ForecastTraining
    current: ForecastCurrent
    disruptive_probability: float
    risk_pct: float
    coefficients: dict[str, float]
    intercept: float
    notes: list[str]


class CryptoAssetStats(BaseModel):
    label: str
    available: bool = False
    start_value: float | None = None
    peak_value: float | None = None
    trough_value: float | None = None
    end_value: float | None = None
    peak_date: str | None = None
    trough_date: str | None = None
    drawdown_pct: float | None = None
    return_pct: float | None = None
    observations: int | None = None


class CryptoCoreIndex(BaseModel):
    at_peak: float | None = None
    at_peak_date: str | None = None
    at_peak_bucket: str | None = None
    at_trough: float | None = None
    at_trough_date: str | None = None
    at_trough_bucket: str | None = None
    min: float | None = None
    min_date: str | None = None
    max: float | None = None
    max_date: str | None = None
    observations: int | None = None


class CryptoMilestoneEvent(BaseModel):
    id: str
    name: str
    short_name: str | None = None
    category: str
    window: ZoomWindow
    peak: str
    trough: str | None = None
    date_precision: str | None = None
    summary: str | None = None
    context: str | None = None
    tags: list[str] = Field(default_factory=list)
    assets: dict[str, CryptoAssetStats]
    core_index: CryptoCoreIndex


class CryptoMilestonesResponse(BaseModel):
    as_of: str
    coverage: Coverage
    version: str
    kind: str
    assets: dict[str, str]
    events: list[CryptoMilestoneEvent]
    notes: list[str]


class PatternSeriesPoint(BaseModel):
    date: str
    value: float


class PatternMarketWindow(BaseModel):
    start: str
    end: str
    asset: str
    source: str | None = None
    level: float
    return_pct: float | None = None
    drawdown_pct: float | None = None
    phase: str
    state: str
    core_index: float | None = None
    core_index_bucket: str | None = None
    series: list[PatternSeriesPoint]


class PatternPeak(BaseModel):
    date: str
    value: float


class PatternEvent(BaseModel):
    date: str
    title: str
    category: str
    summary: str
    source: str


class PatternForwardWindow(BaseModel):
    start: str
    end: str
    asset: str
    first_value: float
    last_value: float
    return_pct: float | None = None
    peak: PatternPeak
    drawdown_peak: PatternPeak
    trough: PatternPeak
    max_drawdown_pct: float
    max_drawdown_from_peak: float
    series: list[PatternSeriesPoint]
    events: list[PatternEvent]


# ---------------------------------------------------------------------------
# Study of Patterns v2: the ``engine`` block of /api/v1/patterns
# (regime/patterns_v2.py). Frequencies are counts beside the usual rate;
# nothing here is a blended probability. Paths reuse PatternSeriesPoint
# (rebased to 100 at the path start) and events reuse PatternEvent.
# ---------------------------------------------------------------------------

# Data provenance of a setup's end point: Cowles monthly index (to 1927),
# S&P 90 (^GSPC before 1957-03-04), S&P 500; dow_jones and nasdaq are kept for
# older artifacts. The UI renders whitelisted codes only.
PatternSourceCode = Literal["cowles", "dow_jones", "nasdaq", "sp90", "sp500"]


class PatternSpanV2(BaseModel):
    periods: int
    unit: Literal["week", "month"]


class PatternWindowV2(BaseModel):
    start: str
    end: str
    return_pct: float | None = None
    drawdown_pct: float | None = None  # last point vs the window high, <= 0
    volatility_pct: float | None = None  # annualised, on the engine's basis
    vol_vs_10y: float | None = None  # current window only
    path: list[PatternSeriesPoint]  # rebased: 100 at the window start


class PatternForwardV2(BaseModel):
    start: str
    end: str
    return_3m_pct: float | None = None
    return_6m_pct: float | None = None
    return_12m_pct: float | None = None
    max_drawdown_pct: float | None = None  # peak-to-trough inside the 12 months, <= 0
    path: list[PatternSeriesPoint]  # rebased: 100 at the forward start


class PatternAnalogV2(BaseModel):
    rank: int  # 1 = closest of the k setups
    position: int  # 1-based rank among all `of` eligible windows
    of: int
    closer_than_pct: float  # share of eligible windows strictly farther; < 100
    source: PatternSourceCode | None = None
    window: PatternWindowV2
    forward: PatternForwardV2
    events: list[PatternEvent]


class PatternHorizonV2(BaseModel):
    months: Literal[3, 6, 12]
    higher: int  # setups higher after `months`
    of: int
    base_share_up_pct: float  # all eligible past windows of the asset
    median_return_pct: float | None = None
    base_median_return_pct: float | None = None


class PatternUsualPathsV2(BaseModel):
    q25: list[PatternSeriesPoint]
    q50: list[PatternSeriesPoint]
    q75: list[PatternSeriesPoint]


class PatternDrawdownV2(BaseModel):
    fell_10: int
    fell_20: int
    of: int
    median_pct: float | None = None
    worst_pct: float | None = None
    base_share_10_pct: float
    base_share_20_pct: float
    base_median_pct: float | None = None


class PatternOutlookV2(BaseModel):
    k: int
    library_windows: int
    library_span: list[str]
    horizons: list[PatternHorizonV2]
    median_path: list[PatternSeriesPoint]
    usual_paths: PatternUsualPathsV2
    drawdown: PatternDrawdownV2


class PatternMirrorWindowV2(BaseModel):
    position: int
    of: int
    closer_than_pct: float
    offset_years: float | None = None  # aligned only
    band_years: list[int] | None = None  # aligned only: [110, 130]
    windows_in_band: int | None = None  # aligned only
    window: PatternWindowV2
    forward: PatternForwardV2
    events: list[PatternEvent]


class PatternMirrorEvidenceV2(BaseModel):
    months_tested: int
    period: list[str]
    mean_rank_pct: float  # mean percentile of the exact mirror among eligible windows
    chance_rank_pct: float  # 50
    z: float
    share_in_closest_10pct: float  # chance: 10
    rank_among_offsets: list[int]  # [rank of 120, number of offsets]
    offsets_years: list[int]  # [60, 150]
    forward_12m_rank_corr: float | None = None
    direction_hit_12m_pct: float | None = None
    base_hit_12m_pct: float | None = None
    verdict: Literal["no_information", "closer_than_chance", "farther_than_chance"]


class PatternMirrorV2(BaseModel):
    available: bool
    reason: Literal["history_too_short", "window_unavailable"] | None = None
    offset_years: int = 120
    exact: PatternMirrorWindowV2 | None = None
    aligned: PatternMirrorWindowV2 | None = None
    evidence: PatternMirrorEvidenceV2 | None = None


class PatternDirectionSkillV2(BaseModel):
    horizon_months: int
    hit_pct: float
    base_hit_pct: float
    edge_ci95_pp: list[float | None] | None = None  # null when the bootstrap failed
    verdict: Literal["no_edge", "worse", "better"]


class PatternFallSkillV2(BaseModel):
    threshold_pct: int  # 10 or 20
    realised_pct: float
    brier_skill: float | None = None
    ci95: list[float | None] | None = None
    auc: float | None = None
    verdict: Literal["no_edge", "worse", "better", "not_measurable"]


class PatternRankingSkillV2(BaseModel):
    horizon_months: int
    rank_corr: float | None = None
    ci95: list[float | None] | None = None
    recent_from: str
    recent_rank_corr: float | None = None
    recent_ci95: list[float | None] | None = None
    verdict: Literal["none", "unstable", "weak"]


class PatternEpisodeV2(BaseModel):
    peak: str
    trough: str
    depth_pct: float
    source: PatternSourceCode | None = None
    read_on: str
    drawdown_at_read_pct: float
    setups_fell_20: int
    of: int
    base_share_20_pct: float
    further_fall_20: bool  # a further fall of 20% or more within 12 months of read_on
    remaining_fall_pct: float  # read_on to the trough, however long that took


class PatternEpisodeStubV2(BaseModel):
    peak: str
    trough: str
    depth_pct: float
    source: PatternSourceCode | None = None


class PatternEpisodeSummaryV2(BaseModel):
    with_reading: int
    above_usual: int
    above_usual_followed: int
    not_above_usual: int
    not_above_usual_followed: int


class PatternSkillV2(BaseModel):
    available: bool
    generated_at: str | None = None
    data_version: str | None = None
    stale: bool = False
    period: list[str] | None = None
    forecasts: int | None = None
    independent_years: float | None = None
    direction: PatternDirectionSkillV2 | None = None
    falls_20: PatternFallSkillV2 | None = None
    falls_10: PatternFallSkillV2 | None = None
    ranking: PatternRankingSkillV2 | None = None
    episodes: list[PatternEpisodeV2] = Field(default_factory=list)
    episodes_before_record: list[PatternEpisodeStubV2] = Field(default_factory=list)
    episodes_summary: PatternEpisodeSummaryV2 | None = None


class PatternEngineV2(BaseModel):
    version: Literal["patterns-v2"]
    status: Literal["ok", "insufficient"]
    asset: Literal["sp500", "nifty", "gold", "bonds", "bitcoin"]
    as_of: str  # last real observation, not the request date
    history_start: str
    resolution: Literal["W", "M"]
    basis: Literal["weekly_close", "monthly_average"]
    window: PatternSpanV2
    horizon: PatternSpanV2
    current: PatternWindowV2
    analogs: list[PatternAnalogV2]
    outlook: PatternOutlookV2 | None = None  # None when status == "insufficient"
    mirror: PatternMirrorV2
    skill: PatternSkillV2


class PatternsResponse(BaseModel):
    as_of: str
    historical_date: str
    requested_historical_date: str
    mirror_fallback: bool
    mirror_note: str | None = None
    asset: str
    asset_label: str
    forward_end: str
    similarity_percentage: float
    correlation: float
    method: str
    window_days: int
    current: PatternMarketWindow
    historical: PatternMarketWindow
    forward: PatternForwardWindow
    events: list[PatternEvent]
    notes: list[str]
    # Study of Patterns v2 (closest historical setups). Null when it could
    # not be built; the v1 fields above are unchanged for compatibility.
    engine: PatternEngineV2 | None = None
