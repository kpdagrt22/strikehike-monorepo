"""Bundle-first resolution for the macro artifacts the regime pages read.

The weekly events bundle carries the refreshed macro parquet in ``data/``.  The
macro ingestion flow writes the meta and the Patterns v2 skill artifact beside
that parquet, so a bundle built from the same directory can carry them too.
Every reader resolves each file the same way: the active bundle's copy when it
exists, otherwise the file baked into the image.
"""

from __future__ import annotations

from pathlib import Path

MACRO_PARQUET_FILENAME = "macro_regime_history.parquet"
MACRO_META_FILENAME = "macro_regime_history.meta.json"
PATTERNS_SKILL_FILENAME = "patterns_v2_skill.json"


def _current_bundle() -> Path | None:
    try:
        from astro_finance.events.store import current_bundle_dir

        return current_bundle_dir()
    except (ImportError, OSError):
        return None


def resolve_bundle_data_file(filename: str, baked_path: Path | str) -> Path:
    """Return the active bundle's ``data/<filename>``, else ``baked_path``.

    The bundle pointer is mtime-cached by ``current_bundle_dir``, so this stays
    cheap on the request path and follows an activation or rollback.
    """

    baked = Path(baked_path)
    bundle = _current_bundle()
    if bundle is not None:
        candidate = bundle / "data" / filename
        if candidate.is_file():
            return candidate
    return baked
