"""Study of Patterns v2: the `engine` contract, judge r2 (final).

Ported verbatim from the judge's ref_schemas_v2.py. Self-contained, so schemas.py only needs
`from regime.patterns_v2_schemas import PatternEngineV2` and one field on PatternsResponse:
`engine: PatternEngineV2 | None = None`. Every v1 field of PatternsResponse stays.

Rules the models encode:
* counts, never blended probabilities (no p_up / p_ge_* / similarity fields exist);
* every code is a closed Literal, so the UI can whitelist it;
* every float that can be undefined is Optional: the backend must never emit NaN or inf
  (Starlette's JSONResponse uses allow_nan=False, so one NaN turns the whole response into a 500).
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

Asset = Literal["sp500", "nifty", "gold", "bonds", "bitcoin"]
# Only codes the data can produce. "sp500" needs no tag in the UI; "sp90" is ^GSPC before
# 1957-03-04; "cowles" is the NBER/Cowles monthly index (1871-1927, the mirror bank only).
SourceCode = Literal["cowles", "sp90", "sp500"]
EdgeVerdict = Literal["no_edge", "worse", "better"]
FallVerdict = Literal["no_edge", "worse", "better", "not_measurable"]


class PatternPointV2(BaseModel):
    date: str
    value: float


class PatternEventV2(BaseModel):  # same fields as the v1 PatternEvent
    date: str
    title: str
    category: str
    summary: str
    source: str


class PatternSpanV2(BaseModel):
    periods: int
    unit: Literal["week", "month"]


class PatternWindowV2(BaseModel):
    start: str
    end: str
    return_pct: float | None = None
    drawdown_pct: float | None = None  # last point vs the window's high, <= 0
    volatility_pct: float | None = None  # annualised, on the window's basis
    vol_vs_10y: float | None = None  # `current` only: volatility / rolling 10-year median
    path: list[PatternPointV2]  # rebased: 100 at the window start


class PatternForwardV2(BaseModel):
    start: str
    end: str
    return_3m_pct: float | None = None
    return_6m_pct: float | None = None
    return_12m_pct: float | None = None
    max_drawdown_pct: float | None = None  # worst peak-to-trough inside the 12 months, <= 0
    path: list[PatternPointV2]  # rebased: 100 at the forward start


class PatternAnalogV2(BaseModel):
    rank: int  # 1..k, closest first
    position: int  # 1-based rank among all `of` eligible windows
    of: int
    closer_than_pct: float  # (of - position) / of * 100, always < 100; UI shows rank instead
    source: SourceCode | None = None
    window: PatternWindowV2
    forward: PatternForwardV2
    events: list[PatternEventV2]


class PatternHorizonV2(BaseModel):
    months: Literal[3, 6, 12]
    higher: int  # setups higher after `months`
    of: int
    base_share_up_pct: float  # all past windows of the asset ("usual")
    median_return_pct: float | None = None
    base_median_return_pct: float | None = None


class PatternUsualPathsV2(BaseModel):
    q25: list[PatternPointV2]
    q50: list[PatternPointV2]
    q75: list[PatternPointV2]


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
    library_windows: int  # eligible setup windows at as_of
    library_span: list[str]  # [first eligible window start, last eligible window end]
    usual_windows: int  # past forward windows behind every "usual" figure
    usual_since_year: int  # label year of the first usual window (a 30 Dec 1927 start reads 1928)
    horizons: list[PatternHorizonV2]
    median_path: list[PatternPointV2]  # dates are as_of + t; plot by index, never by date
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
    events: list[PatternEventV2]


class PatternMirrorEvidenceV2(BaseModel):
    months_tested: int
    period: list[str]
    mean_rank_pct: float  # mean share of eligible windows closer than the exact mirror
    chance_rank_pct: float  # 50
    z: float
    share_in_closest_10pct: float  # chance 10
    rank_among_offsets: list[int]  # [rank of 120 y, number of offsets]
    offsets_years: list[int]  # [60, 150]
    forward_12m_rank_corr: float | None = None
    direction_hit_12m_pct: float | None = None
    base_hit_12m_pct: float | None = None
    verdict: Literal["no_information", "closer_than_chance", "farther_than_chance"]


class PatternMirrorV2(BaseModel):
    available: bool
    reason: Literal["history_too_short", "window_unavailable"] | None = None
    offset_years: int = 120
    basis: Literal["monthly_average", "weekly_close"] | None = None  # the mirror's own bank
    exact: PatternMirrorWindowV2 | None = None
    aligned: PatternMirrorWindowV2 | None = None
    evidence: PatternMirrorEvidenceV2 | None = None


class PatternDirectionSkillV2(BaseModel):
    horizon_months: int
    hit_pct: float
    base_hit_pct: float
    edge_ci95_pp: list[float] | None = None
    base_call: Literal["up", "down", "mixed"] | None = None  # "up": the usual call was "up" at every test
    verdict: EdgeVerdict


class PatternFallSkillV2(BaseModel):
    threshold_pct: int
    realised_pct: float
    brier_skill: float | None = None
    ci95: list[float] | None = None
    auc: float | None = None
    verdict: FallVerdict


class PatternRankingSkillV2(BaseModel):
    horizon_months: int
    rank_corr: float | None = None
    ci95: list[float] | None = None
    recent_from: str
    recent_rank_corr: float | None = None
    recent_ci95: list[float] | None = None
    verdict: Literal["none", "unstable", "weak"]


class PatternPlaceboV2(BaseModel):
    """The same walk-forward with k random eligible windows (same separation) instead of the setups."""

    seeds: int
    direction_gap_pp_mean: float
    direction_gap_pp_p05: float
    direction_gap_pp_p95: float
    falls_20_brier_skill_mean: float | None = None
    verdict: Literal["same", "setups_worse", "setups_better"] | None = None  # setups' gap vs p05..p95


class PatternWarningsV2(BaseModel):
    """Forecast-level record for falls of `threshold_pct`: setups 'flagged' when their share of
    such falls exceeded the usual share at that date."""

    threshold_pct: int
    flagged_share_pct: float
    flagged_followed_pct: float
    other_followed_pct: float


class PatternDeclinesV2(BaseModel):
    """Every finished fall that reached `read_at_pct`, read at its first close there (counts only;
    the named list of declines lives in the case catalogue, /api/v1/regime/cases)."""

    read_at_pct: int  # 10
    period: list[str]  # first and last read date scored
    declines: int
    became_20: int
    flagged: int  # setups showed more further 10% falls than usual
    flagged_became_20: int
    not_flagged: int
    not_flagged_became_20: int
    auc: float | None = None
    before_record: int  # falls before the first scorable date (library under 20 years)


class PatternSkillV2(BaseModel):
    available: bool
    generated_at: str | None = None
    inputs_fingerprint: str | None = None  # of this asset's price inputs when the record was built
    stale: bool = False  # the parquet's inputs differ from the artifact's
    period: list[str] | None = None
    cadence: Literal["monthly", "every_4_weeks"] | None = None
    forecasts: int | None = None
    independent_years: float | None = None
    direction: PatternDirectionSkillV2 | None = None
    falls_20: PatternFallSkillV2 | None = None
    falls_10: PatternFallSkillV2 | None = None
    ranking: PatternRankingSkillV2 | None = None
    placebo: PatternPlaceboV2 | None = None
    warnings: PatternWarningsV2 | None = None
    declines: PatternDeclinesV2 | None = None


class PatternEngineV2(BaseModel):
    version: Literal["patterns-v2"]
    status: Literal["ok", "insufficient"]
    asset: Asset
    as_of: str  # last real observation (trailing forward fill cut), not the request date
    history_start: str  # first real observation of the asset, any basis
    resolution: Literal["W", "M"]  # the setups' bank
    basis: Literal["weekly_close", "monthly_average"]
    window: PatternSpanV2
    horizon: PatternSpanV2
    separation: PatternSpanV2  # minimum gap between setup end points (= window: no overlap)
    current: PatternWindowV2
    analogs: list[PatternAnalogV2]  # 0..k
    outlook: PatternOutlookV2 | None = None  # None when status == "insufficient"
    mirror: PatternMirrorV2
    skill: PatternSkillV2
