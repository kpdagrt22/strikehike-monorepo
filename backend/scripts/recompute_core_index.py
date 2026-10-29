"""Recompute the Core Index v2 columns of the committed macro artifact.

Recomputes only ``core_index``, ``core_index_composite``,
``core_index_bucket``, ``core_index_severity``, ``core_index_warning``,
``core_index_trend_warning`` and ``core_index_fast_warning`` of
``macro_regime_history.parquet`` from the artifact's own stored inputs (no
network, no re-ingestion). Only stale or missing v2 columns are written;
every other column, including v2 columns
already in sync, keeps its exact Arrow array, so it stays byte-identical when
the same pyarrow version writes the file. The script proves that before and
after writing, then updates the metadata. When the columns are in sync and
only the metadata is stale, it rewrites the metadata alone.

Run
---
    cd backend
    python -m scripts.recompute_core_index [--artifact-dir data/processed]
    python -m scripts.recompute_core_index --check

``--check`` is read-only. It exits 1 when the stored v2 columns or the
metadata differ from a fresh recomputation.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Sequence

import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from regime.analytics import (  # noqa: E402
    CORE_INDEX_NOTE,
    CORE_INDEX_V1_NOTE_PREFIX,
    CORE_INDEX_V2_COLUMNS,
    calculate_core_index_v2,
    core_index_metadata,
)
from scripts.flows.macro_ingestion import PIPELINE_VERSION  # noqa: E402

DEFAULT_ARTIFACT_DIR = BACKEND_DIR / "data" / "processed"
PARQUET_NAME = "macro_regime_history.parquet"
META_NAME = "macro_regime_history.meta.json"
# Columns v1 already wrote, replaced in place; columns v2 adds after the
# bucket, in this order.
REPLACED = ("core_index", "core_index_composite", "core_index_bucket")
ADDED = (
    "core_index_severity",
    "core_index_warning",
    "core_index_trend_warning",
    "core_index_fast_warning",
)
CORE_INDEX_NOTE_PREFIXES = (CORE_INDEX_V1_NOTE_PREFIX, "Core Index v2 ")
FLOAT_TOLERANCE = 1e-9


class RecomputeError(RuntimeError):
    """A proof failed; the artifact was not changed."""


def _version(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()[:12]


def _chunk_bytes(raw: bytes) -> dict[str, list[bytes]]:
    """Column path -> encoded bytes of its chunks (dictionary + data pages)."""
    metadata = pq.ParquetFile(io.BytesIO(raw)).metadata
    out: dict[str, list[bytes]] = {}
    for group in range(metadata.num_row_groups):
        row_group = metadata.row_group(group)
        for position in range(row_group.num_columns):
            column = row_group.column(position)
            start = (
                column.dictionary_page_offset
                if column.has_dictionary_page and column.dictionary_page_offset
                else column.data_page_offset
            )
            out.setdefault(column.path_in_schema, []).append(
                raw[start : start + column.total_compressed_size]
            )
    return out


def _labels(series: pd.Series) -> list[Any]:
    return series.astype(object).where(series.notna(), None).tolist()


def _same_values(stored: pd.Series, fresh: pd.Series) -> bool:
    if len(stored) != len(fresh):
        return False
    if pd.api.types.is_float_dtype(fresh):
        left = pd.to_numeric(stored, errors="coerce").to_numpy(dtype=float)
        right = fresh.to_numpy(dtype=float)
        return bool(
            np.array_equal(np.isnan(left), np.isnan(right))
            and np.allclose(left, right, rtol=0.0, atol=FLOAT_TOLERANCE, equal_nan=True)
        )
    return _labels(stored) == _labels(fresh)


def _stale_columns(frame: pd.DataFrame, core: pd.DataFrame) -> list[str]:
    stale = []
    for column in CORE_INDEX_V2_COLUMNS:
        if column not in frame.columns or not _same_values(
            frame[column], core[column].reindex(frame.index)
        ):
            stale.append(column)
    return stale


def _arrow_arrays(core: pd.DataFrame) -> dict[str, pa.Array]:
    def floats(name: str) -> pa.Array:
        values = core[name].to_numpy(dtype=float)
        return pa.array(values, type=pa.float64(), from_pandas=True)

    return {
        "core_index": floats("core_index"),
        "core_index_composite": floats("core_index_composite"),
        "core_index_bucket": pa.array(
            _labels(core["core_index_bucket"]), type=pa.large_string()
        ),
        "core_index_severity": pa.array(
            _labels(core["core_index_severity"]), type=pa.large_string()
        ),
        "core_index_warning": pa.array(
            _labels(core["core_index_warning"]), type=pa.bool_()
        ),
        "core_index_trend_warning": pa.array(
            _labels(core["core_index_trend_warning"]), type=pa.bool_()
        ),
        # Same Arrow type and pandas metadata as the trend warning (nullable
        # boolean under pandas 2 and 3); see _pandas_entry.
        "core_index_fast_warning": pa.array(
            _labels(core["core_index_fast_warning"]), type=pa.bool_()
        ),
    }


def _pandas_entry(entries: list[dict[str, Any]], name: str) -> dict[str, Any]:
    """pandas metadata for an added column, described like its sibling so
    pandas restores the string or nullable-boolean dtype."""
    if name == "core_index_severity":
        bucket = next(entry for entry in entries if entry["name"] == "core_index_bucket")
        return dict(bucket, name=name, field_name=name)
    return {
        "name": name,
        "field_name": name,
        "pandas_type": "bool",
        "numpy_type": "boolean",
        "metadata": None,
    }


def _replace_columns(
    old: pa.Table, arrays: dict[str, pa.Array], stale: Sequence[str]
) -> pa.Table:
    """Write the stale v2 columns: those the artifact has are replaced in
    place, missing ones are added after ``core_index_bucket`` in ``ADDED``
    order. A v2 column already in sync keeps its stored array."""
    new = old
    for name in REPLACED:
        position = new.schema.get_field_index(name)
        if position < 0:
            raise RecomputeError(f"{name} is missing from the artifact")
        if name in stale:
            new = new.set_column(position, pa.field(name, arrays[name].type), arrays[name])
    previous = "core_index_bucket"
    for name in ADDED:
        field = pa.field(name, arrays[name].type)
        if name not in new.schema.names:
            new = new.add_column(new.schema.get_field_index(previous) + 1, field, arrays[name])
        elif name in stale:
            new = new.set_column(new.schema.get_field_index(name), field, arrays[name])
        previous = name

    pandas_meta = json.loads(old.schema.metadata[b"pandas"])
    entries = pandas_meta["columns"]
    previous = "core_index_bucket"
    for name in ADDED:
        names = [entry["name"] for entry in entries]
        if name not in names:
            entries.insert(names.index(previous) + 1, _pandas_entry(entries, name))
        previous = name
    return new.replace_schema_metadata(
        {**old.schema.metadata, b"pandas": json.dumps(pandas_meta).encode("utf-8")}
    )


def _prove_untouched(old: pa.Table, new: pa.Table) -> int:
    """Every column that is not a v2 column is unchanged (type and values,
    nulls included), in the same order, with the same row count."""
    changed, retyped = [], []
    for name in old.schema.names:
        if name in CORE_INDEX_V2_COLUMNS:
            continue
        if name not in new.schema.names:
            changed.append(name)
        elif old.schema.field(name).type != new.schema.field(name).type:
            retyped.append(name)
        elif not old.column(name).equals(new.column(name)):
            changed.append(name)
    if changed or retyped:
        raise RecomputeError(
            f"non-Core-Index columns changed: {changed}; types changed: {retyped}"
        )
    kept = [name for name in old.schema.names if name not in ADDED]
    if kept != [name for name in new.schema.names if name not in ADDED]:
        raise RecomputeError("the order of the existing columns changed")
    if old.num_rows != new.num_rows:
        raise RecomputeError("the row count changed")
    return len([name for name in old.schema.names if name not in CORE_INDEX_V2_COLUMNS])


def _frame_columns(table: pa.Table) -> list[str]:
    pandas_meta = json.loads(table.schema.metadata[b"pandas"])
    index_columns = {
        name for name in pandas_meta.get("index_columns", []) if isinstance(name, str)
    }
    return [name for name in table.schema.names if name not in index_columns]


def _updated_meta(
    meta: dict[str, Any],
    core: pd.DataFrame,
    columns: list[str],
    *,
    data_version: str,
    previous_version: str,
    recomputed_at: str | None,
) -> dict[str, Any]:
    meta = json.loads(json.dumps(meta))
    meta["data_version"] = data_version
    meta["pipeline_version"] = PIPELINE_VERSION
    frame_meta = meta.setdefault("frame", {})
    frame_meta["columns"] = len(columns)
    frame_meta["columns_list"] = list(columns)
    block = core_index_metadata(core)
    if recomputed_at is not None:
        block["recomputed_at"] = recomputed_at
        block["recomputed_from_data_version"] = previous_version
    else:
        previous = meta.get("core_index", {})
        for key in ("recomputed_at", "recomputed_from_data_version"):
            if key in previous:
                block[key] = previous[key]
    meta["core_index"] = block
    meta["notes"] = [
        CORE_INDEX_NOTE if str(note).startswith(CORE_INDEX_NOTE_PREFIXES) else note
        for note in meta.get("notes", [])
    ]
    return meta


def _dump_meta(meta: dict[str, Any], crlf: bool) -> bytes:
    text = json.dumps(meta, indent=2, sort_keys=True, default=str)
    if crlf:
        text = text.replace("\n", "\r\n")
    return text.encode("utf-8")


def _meta_mismatches(meta: dict[str, Any], expected: dict[str, Any]) -> list[str]:
    keys = ("data_version", "pipeline_version", "frame", "core_index", "notes")
    mismatched = []
    for key in keys:
        left, right = meta.get(key), expected.get(key)
        if key == "core_index" and isinstance(left, dict) and isinstance(right, dict):
            left = {k: v for k, v in left.items() if not k.startswith("recomputed_")}
            right = {k: v for k, v in right.items() if not k.startswith("recomputed_")}
        if left != right:
            mismatched.append(key)
    return mismatched


def recompute(artifact_dir: Path, *, check_only: bool = False) -> dict[str, Any]:
    parquet_path = Path(artifact_dir) / PARQUET_NAME
    meta_path = Path(artifact_dir) / META_NAME
    old_bytes = parquet_path.read_bytes()
    old_version = _version(old_bytes)
    old_meta_bytes = meta_path.read_bytes()
    meta = json.loads(old_meta_bytes.decode("utf-8"))
    crlf = b"\r\n" in old_meta_bytes

    old = pq.read_table(io.BytesIO(old_bytes))
    frame = old.to_pandas()
    core = calculate_core_index_v2(frame)
    stale = _stale_columns(frame, core)
    expected_meta = _updated_meta(
        meta,
        core,
        _frame_columns(old),
        data_version=old_version,
        previous_version=old_version,
        recomputed_at=None,
    )
    meta_stale = _meta_mismatches(meta, expected_meta)
    report: dict[str, Any] = {
        "artifact": str(parquet_path),
        "data_version": old_version,
        "rows": int(old.num_rows),
        "in_sync": not stale and not meta_stale,
        "stale_columns": stale,
        "stale_meta_keys": meta_stale,
        "first_scored": expected_meta["core_index"]["first_scored"],
        "latest": expected_meta["core_index"]["latest"],
    }
    if check_only or report["in_sync"]:
        report.update(written=False, parquet_written=False)
        return report
    if not stale:
        # Only the metadata is stale (for example a changed definition or
        # record): rewrite it alone. The parquet, its data_version and the
        # recomputed_* keys stay as they are.
        meta_temporary = meta_path.with_suffix(meta_path.suffix + ".tmp")
        meta_temporary.write_bytes(_dump_meta(expected_meta, crlf))
        meta_temporary.replace(meta_path)
        report.update(
            written=True,
            parquet_written=False,
            in_sync=True,
            stale_meta_keys=[],
            updated_meta_keys=meta_stale,
        )
        return report

    new = _replace_columns(old, _arrow_arrays(core), stale)
    untouched = _prove_untouched(old, new)

    temporary = parquet_path.with_suffix(parquet_path.suffix + ".tmp")
    pq.write_table(new, temporary, compression="snappy")
    new_bytes = temporary.read_bytes()
    reread = pq.read_table(io.BytesIO(new_bytes))
    _prove_untouched(old, reread)
    reread_frame = reread.to_pandas()
    if _stale_columns(reread_frame, core):
        temporary.unlink()
        raise RecomputeError("the written v2 columns do not read back as computed")
    new_version = _version(new_bytes)
    updated = _updated_meta(
        meta,
        core,
        _frame_columns(new),
        data_version=new_version,
        previous_version=old_version,
        recomputed_at=datetime.now(timezone.utc).isoformat(),
    )

    old_chunks, new_chunks = _chunk_bytes(old_bytes), _chunk_bytes(new_bytes)
    names = [name for name in old.schema.names if name not in CORE_INDEX_V2_COLUMNS]
    different = [name for name in names if old_chunks.get(name) != new_chunks.get(name)]
    # Every column the artifact already had, v2 columns included: which ones
    # the rewrite changed (values) or re-encoded (bytes).
    rewritten = [
        name for name in CORE_INDEX_V2_COLUMNS if name in old.schema.names and name in stale
    ]
    existing_changed = [
        name for name in old.schema.names if not old.column(name).equals(reread.column(name))
    ]
    existing_reencoded = [
        name for name in old.schema.names if old_chunks.get(name) != new_chunks.get(name)
    ]

    temporary.replace(parquet_path)
    try:
        meta_temporary = meta_path.with_suffix(meta_path.suffix + ".tmp")
        meta_temporary.write_bytes(_dump_meta(updated, crlf))
        meta_temporary.replace(meta_path)
    except OSError:
        parquet_path.write_bytes(old_bytes)
        raise

    report.update(
        written=True,
        parquet_written=True,
        in_sync=True,
        stale_columns=[],
        stale_meta_keys=[],
        previous_data_version=old_version,
        data_version=new_version,
        columns=int(new.num_columns),
        frame_columns=updated["frame"]["columns"],
        untouched_columns_arrow_equal=untouched,
        untouched_columns_byte_identical=len(names) - len(different),
        untouched_columns_reencoded=different,
        existing_columns=len(old.schema.names),
        existing_columns_changed=existing_changed,
        existing_columns_reencoded=existing_reencoded,
        replaced=rewritten,
        added=[name for name in ADDED if name not in old.schema.names],
        pyarrow=pa.__version__,
        pandas=pd.__version__,
    )
    return report


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Recompute the Core Index v2 columns of the macro artifact."
    )
    parser.add_argument(
        "--artifact-dir",
        type=Path,
        default=DEFAULT_ARTIFACT_DIR,
        help="Folder holding macro_regime_history.parquet and .meta.json.",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="Read-only: exit 1 if the stored v2 columns or metadata are stale.",
    )
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        report = recompute(args.artifact_dir, check_only=args.check)
    except RecomputeError as exc:
        print(f"refusing to write: {exc}", file=sys.stderr)
        return 2
    print(json.dumps(report, indent=2, default=str))
    if args.check and not report["in_sync"]:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
