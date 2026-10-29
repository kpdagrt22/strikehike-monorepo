"""Pydantic response models for the Convergence case catalogue.

Kept apart from ``regime.schemas`` so the case API and the Patterns models can
change independently. Every field that can be null is ``Optional`` with a
``None`` default.
"""

from __future__ import annotations

from typing import Optional, Union

from pydantic import BaseModel, ConfigDict, Field


class CaseSeries(BaseModel):
    key: str
    source: Optional[str] = None
    label: str
    resolution: str
    precision: str
    spans_splice: bool = False


class CaseCoreIndex(BaseModel):
    at_peak: Optional[float] = None
    at_peak_date: Optional[str] = None
    at_peak_bucket: Optional[str] = None
    at_trough: Optional[float] = None
    at_trough_date: Optional[str] = None
    at_trough_bucket: Optional[str] = None


class CaseMacroReading(BaseModel):
    value: Optional[float] = None
    regime_state: Optional[str] = None
    coverage: Optional[float] = None


class CaseMacroStrength(BaseModel):
    at_peak: Optional[CaseMacroReading] = None
    at_trough: Optional[CaseMacroReading] = None


class CaseSky(BaseModel):
    date: str
    precision: str
    available: bool


class CaseEvent(BaseModel):
    date: str
    end: Optional[str] = None
    name: str
    source: str


class CaseLatest(BaseModel):
    date: str
    pct_from_peak: Optional[float] = None


class CaseLowerLow(BaseModel):
    date: str
    pct_from_peak: Optional[float] = None


class CaseFlags(BaseModel):
    open: bool = False
    recovery_unobservable: bool = False
    spans_splice: bool = False
    month_precise: bool = False


class Case(BaseModel):
    id: str
    kind: str
    name: str
    short_name: str
    name_source: str
    aka: list[str] = Field(default_factory=list)
    region: str
    series: CaseSeries
    peak: str
    trough: str
    recovery: Optional[str] = None
    recovery_status: str
    depth_pct: float
    days_to_trough: int
    days_to_recovery: Optional[int] = None
    latest: Optional[CaseLatest] = None
    lower_low: Optional[CaseLowerLow] = None
    core_index: Optional[CaseCoreIndex] = None
    macro_strength: Optional[CaseMacroStrength] = None
    sky: CaseSky
    series_available: list[str] = Field(default_factory=list)
    recessions: list[str] = Field(default_factory=list)
    events: list[CaseEvent] = Field(default_factory=list)
    description: str
    flags: CaseFlags


class CaseKind(BaseModel):
    key: str
    label: str
    region: str
    threshold_pct: Union[int, float]
    rule: str


class CasePair(BaseModel):
    a: str
    b: str


class RecessionContext(BaseModel):
    id: str
    name: str
    start_month: str
    end_month: str


class CaseDateRange(BaseModel):
    start: str
    end: str


class CaseSegment(BaseModel):
    source: Optional[str] = None
    label: str
    resolution: str
    start: str
    end: str


class CasesCoverage(BaseModel):
    core_index_start: Optional[str] = None
    macro_strength_start: Optional[str] = None
    macro_strength_full_from: Optional[str] = None
    ephemeris: CaseDateRange
    equity_gap: Optional[CaseDateRange] = None
    series_first_obs: dict[str, str] = Field(default_factory=dict)
    series_last_obs: dict[str, str] = Field(default_factory=dict)
    sp500_index_start: Optional[str] = None
    us_equity_segments: list[CaseSegment] = Field(default_factory=list)


class CasesResponse(BaseModel):
    version: str
    as_of: str
    data_version: Optional[str] = None
    coverage: CasesCoverage
    kinds: list[CaseKind]
    default_pair: Optional[CasePair] = None
    pairs: list[CasePair] = Field(default_factory=list)
    recessions: list[RecessionContext] = Field(default_factory=list)
    counts: dict[str, int] = Field(default_factory=dict)
    cases: list[Case]
    notes: list[str] = Field(default_factory=list)


class CasePathSplice(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    d: int
    from_source: Optional[str] = Field(default=None, alias="from")
    to: Optional[str] = None


class CasePathResponse(BaseModel):
    id: str
    series: str
    series_label: str
    resolution: str
    t0: str
    base_date: str
    base_value: Optional[float] = None
    from_days: int
    last_obs: str
    ends: str
    d: list[int]
    v: list[float]
    ci: Optional[list[Optional[float]]] = None
    ms: Optional[list[Optional[float]]] = None
    splices: list[CasePathSplice] = Field(default_factory=list)
    align: Optional[str] = None
    current_pct_from_peak: Optional[float] = None
    peak_date: Optional[str] = None
