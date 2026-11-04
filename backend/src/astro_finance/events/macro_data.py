"""Validation for the weekly macro parquet refresh."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import pandas as pd

CORE_COLUMNS = (
    "sp500_proxy",
    "core_index",
    "macro_strength",
    "fed_cross",
    "curve_cross",
    "sahm_alert",
    "regime_state",
)
NAN_TOLERANCE = 0.10


class MacroDataError(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class MacroValidation:
    passed: bool
    checks: tuple[dict[str, Any], ...]
    rows: int
    previous_rows: int
    last_date: str | None
    previous_last_date: str | None
    fingerprint: str
    dataset_version: str
    reasons: tuple[str, ...] = field(default_factory=tuple)

    def to_dict(self) -> dict[str, Any]:
        return {
            "passed": self.passed,
            "checks": list(self.checks),
            "rows": self.rows,
            "previous_rows": self.previous_rows,
            "last_date": self.last_date,
            "previous_last_date": self.previous_last_date,
            "fingerprint": self.fingerprint,
            "dataset_version": self.dataset_version,
            "reasons": list(self.reasons),
        }


def _load(path: Path) -> pd.DataFrame:
    try:
        frame = pd.read_parquet(path)
    except (OSError, ValueError) as exc:
        raise MacroDataError(f"cannot read {path.name}: {exc}") from exc
    frame = frame.copy()
    frame.index = pd.to_datetime(frame.index, utc=True)
    return frame.sort_index()


def frame_fingerprint(frame: pd.DataFrame) -> str:
    hashed = pd.util.hash_pandas_object(frame, index=True).values.tobytes()
    return hashlib.sha256(hashed).hexdigest()[:16]


def validate_macro_refresh(
    data_path: Path,
    baseline_path: Path,
    *,
    allow_unchanged_reason: str | None = None,
) -> MacroValidation:
    current = _load(data_path)
    baseline = _load(baseline_path)
    checks: list[dict[str, Any]] = []

    schema_ok = list(current.columns) == list(baseline.columns)
    checks.append(
        {
            "id": "schema",
            "status": "pass" if schema_ok else "fail",
            "reason": (
                "columns match the baseline"
                if schema_ok
                else "columns differ from the baseline"
            ),
        }
    )

    rows_ok = len(current) >= len(baseline)
    checks.append(
        {
            "id": "row_count",
            "status": "pass" if rows_ok else "fail",
            "reason": f"{len(current)} rows vs baseline {len(baseline)}",
        }
    )

    current_last = current.index.max() if len(current) else None
    previous_last = baseline.index.max() if len(baseline) else None
    advanced = (
        current_last is not None
        and previous_last is not None
        and current_last > previous_last
    )
    unchanged = (
        current_last is not None
        and previous_last is not None
        and current_last == previous_last
    )
    unchanged_ok = unchanged and bool((allow_unchanged_reason or "").strip())
    last_ok = advanced or unchanged_ok
    last_reason = (
        f"last date advanced to {current_last.date().isoformat()}"
        if advanced
        else (
            f"last date unchanged at {current_last.date().isoformat()}: "
            f"{allow_unchanged_reason.strip()}"
            if unchanged_ok
            else "last date did not advance"
        )
    )
    checks.append(
        {
            "id": "last_date",
            "status": "pass" if last_ok else "fail",
            "reason": last_reason,
        }
    )

    nan_checks = []
    for column in CORE_COLUMNS:
        if column not in current.columns or column not in baseline.columns:
            continue
        current_nan = float(current[column].isna().mean())
        baseline_nan = float(baseline[column].isna().mean())
        passed = current_nan <= baseline_nan + NAN_TOLERANCE
        nan_checks.append(
            {
                "column": column,
                "current_nan": round(current_nan, 6),
                "baseline_nan": round(baseline_nan, 6),
                "pass": passed,
            }
        )
    nan_ok = all(item["pass"] for item in nan_checks)
    checks.append(
        {
            "id": "nan_core_columns",
            "status": "pass" if nan_ok else "fail",
            "reason": (
                "core NaN fractions are within +10 percentage points of baseline"
                if nan_ok
                else "a core column's NaN fraction rose by more than 10 points"
            ),
            "columns": nan_checks,
        }
    )

    if "core_index" in current.columns:
        values = pd.to_numeric(current["core_index"], errors="coerce").dropna()
        range_ok = bool(len(values)) and float(values.min()) >= -50.0 and float(values.max()) <= 50.0
        range_reason = (
            f"Core Index range [{float(values.min()):.4f}, {float(values.max()):.4f}]"
            if len(values)
            else "Core Index has no numeric values"
        )
    else:
        range_ok = False
        range_reason = "Core Index column is missing"
    checks.append(
        {
            "id": "core_index_range",
            "status": "pass" if range_ok else "fail",
            "reason": range_reason,
        }
    )

    reasons = tuple(
        f"{item['id']}: {item['reason']}"
        for item in checks
        if item["status"] != "pass"
    )
    fingerprint = frame_fingerprint(current)
    return MacroValidation(
        passed=not reasons,
        checks=tuple(checks),
        rows=len(current),
        previous_rows=len(baseline),
        last_date=current_last.date().isoformat() if current_last is not None else None,
        previous_last_date=(
            previous_last.date().isoformat() if previous_last is not None else None
        ),
        fingerprint=fingerprint,
        dataset_version=fingerprint,
        reasons=reasons,
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Validate a macro parquet refresh.")
    subparsers = parser.add_subparsers(dest="command", required=True)
    validate = subparsers.add_parser("validate")
    validate.add_argument("--data", type=Path, required=True)
    validate.add_argument("--baseline", type=Path, required=True)
    validate.add_argument(
        "--allow-unchanged-reason",
        default=None,
        help="Explicit reason to allow the last date to stay unchanged",
    )
    validate.add_argument("--json-out", type=Path)
    args = parser.parse_args(argv)
    try:
        result = validate_macro_refresh(
            args.data,
            args.baseline,
            allow_unchanged_reason=args.allow_unchanged_reason,
        )
    except MacroDataError as exc:
        print(f"macro validation failed: {exc}", file=sys.stderr)
        return 1
    payload = result.to_dict()
    text = json.dumps(payload, indent=2)
    if args.json_out:
        args.json_out.write_text(text + "\n", encoding="utf-8")
    print(text)
    return 0 if result.passed else 1


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
