"""Read and validate the source registry and its curated overlays."""

from __future__ import annotations

import tomllib
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any

from .models import Reliability, SourceKind, Theme, Verification
from .text import is_https_url, normalize_text, parse_date


def default_data_dir() -> Path:
    """``backend/data/events`` resolved from this package, not the cwd."""

    return Path(__file__).resolve().parents[3] / "data" / "events"


@dataclass(frozen=True, slots=True)
class ReleaseSpec:
    release_id: int
    name: str
    verified_on: date


@dataclass(frozen=True, slots=True)
class SourceSpec:
    id: str
    themes: tuple[Theme, ...]
    kind: SourceKind
    url: str
    terms: str
    rate_limit: str
    expected_freshness_days: int
    reliability: Reliability
    enabled: bool
    verification: Verification
    immutable: bool = False
    horizon_days: int = 365
    max_pages: int = 5
    page_limit: int = 1000
    releases: tuple[ReleaseSpec, ...] = ()


@dataclass(frozen=True, slots=True)
class Registry:
    schema_version: int
    updated: date | None
    sources: tuple[SourceSpec, ...]
    path: Path

    def enabled(self) -> tuple[SourceSpec, ...]:
        return tuple(source for source in self.sources if source.enabled)

    def by_id(self) -> dict[str, SourceSpec]:
        return {source.id: source for source in self.sources}


def _require(mapping: dict[str, Any], key: str, where: str) -> Any:
    if key not in mapping:
        raise ValueError(f"{where}: missing required key {key!r}")
    return mapping[key]


def _parse_source(raw: dict[str, Any], index: int) -> SourceSpec:
    where = f"sources[{index}]"
    source_id = normalize_text(_require(raw, "id", where))
    if not source_id:
        raise ValueError(f"{where}: id must not be empty")
    themes_raw = _require(raw, "themes", where)
    if not isinstance(themes_raw, list) or not themes_raw:
        raise ValueError(f"{where}: themes must be a non-empty list")
    try:
        themes = tuple(Theme(str(value)) for value in themes_raw)
    except ValueError as exc:
        raise ValueError(f"{where}: {exc}") from exc

    try:
        kind = SourceKind(str(_require(raw, "kind", where)))
    except ValueError as exc:
        raise ValueError(f"{where}: unknown kind: {exc}") from exc
    try:
        reliability = Reliability(str(_require(raw, "reliability", where)))
    except ValueError as exc:
        raise ValueError(f"{where}: unknown reliability: {exc}") from exc
    try:
        verification = Verification(str(_require(raw, "verification", where)))
    except ValueError as exc:
        raise ValueError(f"{where}: unknown verification: {exc}") from exc

    url = normalize_text(_require(raw, "url", where))
    if not is_https_url(url):
        raise ValueError(f"{where}: url must be an absolute https URL")
    terms = normalize_text(_require(raw, "terms", where))
    rate_limit = normalize_text(_require(raw, "rate_limit", where))
    freshness = int(_require(raw, "expected_freshness_days", where))
    if freshness < 0:
        raise ValueError(f"{where}: expected_freshness_days must be >= 0")

    releases: list[ReleaseSpec] = []
    for release_index, release in enumerate(raw.get("releases", [])):
        release_where = f"{where}.releases[{release_index}]"
        release_id = int(_require(release, "release_id", release_where))
        name = normalize_text(_require(release, "name", release_where))
        verified_on = parse_date(_require(release, "verified_on", release_where))
        if release_id <= 0:
            raise ValueError(f"{release_where}: release_id must be positive")
        releases.append(ReleaseSpec(release_id, name, verified_on))

    return SourceSpec(
        id=source_id,
        themes=themes,
        kind=kind,
        url=url,
        terms=terms,
        rate_limit=rate_limit,
        expected_freshness_days=freshness,
        reliability=reliability,
        enabled=bool(raw.get("enabled", True)),
        verification=verification,
        immutable=bool(raw.get("immutable", False)),
        horizon_days=int(raw.get("horizon_days", 365)),
        max_pages=int(raw.get("max_pages", 5)),
        page_limit=int(raw.get("page_limit", 1000)),
        releases=tuple(releases),
    )


def load_registry(path: Path | None = None) -> Registry:
    registry_path = Path(path) if path else default_data_dir() / "sources.toml"
    with registry_path.open("rb") as handle:
        payload = tomllib.load(handle)
    sources_raw = payload.get("sources", [])
    if not isinstance(sources_raw, list) or not sources_raw:
        raise ValueError(f"{registry_path}: no [[sources]] entries")
    sources = tuple(_parse_source(raw, index) for index, raw in enumerate(sources_raw))
    ids = [source.id for source in sources]
    if len(ids) != len(set(ids)):
        raise ValueError(f"{registry_path}: duplicate source ids: {ids}")
    updated_raw = payload.get("updated")
    updated = parse_date(updated_raw) if updated_raw else None
    return Registry(
        schema_version=int(payload.get("schema_version", 1)),
        updated=updated,
        sources=sources,
        path=registry_path,
    )


def select_sources(
    registry: Registry, requested: list[str] | None
) -> tuple[SourceSpec, ...]:
    """Apply ``--sources`` and enabled flags; unknown ids are an error."""

    known = registry.by_id()
    if requested:
        missing = [value for value in requested if value not in known]
        if missing:
            raise ValueError(f"unknown source ids: {', '.join(sorted(missing))}")
        selected = [known[value] for value in requested]
    else:
        selected = list(registry.sources)
    active = [source for source in selected if source.enabled]
    if not active:
        raise ValueError("no enabled sources selected")
    return tuple(active)
