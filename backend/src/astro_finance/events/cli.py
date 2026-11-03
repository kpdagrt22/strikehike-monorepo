"""Command line entry point: build, validate, report and diff bundles."""

from __future__ import annotations

import argparse
import json
import sys
from datetime import date, datetime, time, timezone
from pathlib import Path
from typing import Sequence

from .activate import (
    DEFAULT_REPO,
    activate_bundle,
    activation_status,
    rollback_bundle,
)
from .bundle import validate_bundle_files
from .logging_utils import StructuredLogger, make_execution_id
from .models import Event
from .pipeline import PipelineError, PipelineOptions, run_pipeline
from .release import ActivationError
from .security import redact_secrets


class _Parser(argparse.ArgumentParser):
    """Usage errors exit 1 so exit code 2 means "gates failed" only."""

    def error(self, message: str) -> None:  # pragma: no cover - argparse boundary
        self.print_usage(sys.stderr)
        raise SystemExit(1)


def _parse_today(value: str | None) -> date:
    if value is None:
        return datetime.now(timezone.utc).date()
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError(
            f"--today must be YYYY-MM-DD, got {value!r}"
        ) from exc


def _parse_sources(value: str | None) -> tuple[str, ...] | None:
    if not value:
        return None
    values = tuple(part.strip() for part in value.split(",") if part.strip())
    return values or None


def _logger(name: str) -> StructuredLogger:
    now = datetime.now(timezone.utc)
    execution_id = make_execution_id(now, now.date(), (name,))
    return StructuredLogger(execution_id)


def _build(args: argparse.Namespace) -> int:
    today = _parse_today(args.today)
    created_at = datetime.now(timezone.utc)
    # Source and event timestamps use the start of the UTC build date.  This
    # keeps same-day rebuilds byte-identical; only manifest.created_at carries
    # the wall-clock moment.
    anchor = datetime.combine(today, time.min, tzinfo=timezone.utc)
    requested = _parse_sources(args.sources)
    execution_id = make_execution_id(created_at, today, requested or ())
    logger = StructuredLogger(execution_id, min_level=args.log_level)
    logger.info(
        "build_start",
        today=today.isoformat(),
        out=str(args.out),
        previous=str(args.previous) if args.previous else None,
        offline=str(args.offline) if args.offline else None,
        sources=list(requested or []),
    )
    try:
        result = run_pipeline(
            PipelineOptions(
                out_dir=args.out,
                previous_dir=args.previous,
                today=today,
                now=anchor,
                offline_dir=args.offline,
                requested_sources=requested,
                execution_id=execution_id,
                created_at=created_at,
            ),
            logger=logger,
        )
    except PipelineError as exc:
        logger.error("build_failed", error=str(exc))
        return 1
    except Exception as exc:  # pragma: no cover - last-resort CLI boundary
        logger.error("build_error", error=f"{type(exc).__name__}: {exc}")
        return 1

    print(f"bundle_dir: {result.bundle_dir}")
    print(f"bundle_version: {result.bundle_version}")
    print(f"events: {result.quality_report['summary'].get('events_total', 0)}")
    print(f"publishable: {'yes' if result.publishable else 'no'}")
    failed = [
        gate["id"]
        for gate in result.quality_report.get("gates", [])
        if gate["status"] != "pass"
    ]
    if failed:
        print(f"failed_gates: {', '.join(failed)}")
    for gate in result.quality_report.get("gates", []):
        if gate["status"] != "pass":
            print(f"gate_failed: {gate['id']}: {gate['reason']}")
    logger.info(
        "build_end",
        bundle_version=result.bundle_version,
        publishable=result.publishable,
        exit_code=result.exit_code,
    )
    return result.exit_code


def _validate(args: argparse.Namespace) -> int:
    logger = _logger("validate")
    bundle_dir = args.bundle
    errors = validate_bundle_files(bundle_dir)
    report_path = bundle_dir / "quality_report.json"
    if not report_path.exists():
        errors.append(f"missing {report_path}")
    report = {}
    if report_path.exists():
        try:
            report = json.loads(report_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            errors.append(f"invalid quality_report.json: {exc}")
    if errors:
        for error in errors:
            logger.error("validate_error", error=error)
            print(f"error: {error}")
        return 1
    if not report.get("publishable", False):
        for gate in report.get("gates", []):
            if gate.get("status") != "pass":
                print(f"gate_failed: {gate['id']}: {gate.get('reason')}")
        logger.warning("validate_gates_failed")
        return 2
    print(f"valid: {bundle_dir}")
    return 0


def _report(args: argparse.Namespace) -> int:
    path = args.bundle / "quality_report.md"
    if not path.exists():
        print(f"missing {path}", file=sys.stderr)
        return 1
    sys.stdout.write(path.read_text(encoding="utf-8"))
    return 0


def _load_events(bundle_dir: Path) -> dict[str, Event]:
    payload = json.loads((bundle_dir / "events.json").read_text(encoding="utf-8"))
    return {
        event.event_id: event
        for event in (Event.from_dict(item) for item in payload.get("events", []))
    }


def _diff(args: argparse.Namespace) -> int:
    try:
        old = _load_events(args.old)
        new = _load_events(args.new)
    except (OSError, json.JSONDecodeError, KeyError, ValueError) as exc:
        print(f"cannot read bundles: {exc}", file=sys.stderr)
        return 1
    added = sorted(set(new) - set(old))
    removed = sorted(set(old) - set(new))
    changed = sorted(
        event_id
        for event_id in set(old) & set(new)
        if old[event_id].content_hash != new[event_id].content_hash
    )
    print(f"added: {len(added)}")
    for event_id in added:
        print(f"  + {event_id}: {new[event_id].name} ({new[event_id].start_date})")
    print(f"removed: {len(removed)}")
    for event_id in removed:
        print(f"  - {event_id}: {old[event_id].name} ({old[event_id].start_date})")
    print(f"changed: {len(changed)}")
    for event_id in changed:
        print(
            f"  ~ {event_id}: {old[event_id].status.value} "
            f"{old[event_id].start_date} -> {new[event_id].status.value} "
            f"{new[event_id].start_date}"
        )
    return 0


def _activate(args: argparse.Namespace) -> int:
    try:
        result = activate_bundle(
            version=args.version,
            repo=args.repo or DEFAULT_REPO,
            runtime_dir=args.runtime_dir,
            release_dir=args.release_dir,
        )
    except ActivationError as exc:
        print(f"activation failed: {exc}", file=sys.stderr)
        return 1
    print(f"active_version: {result.version}")
    print(f"bundle_dir: {result.bundle_dir}")
    print(f"previous_version: {result.previous_version or 'none'}")
    if result.pruned:
        print(f"pruned: {', '.join(result.pruned)}")
    return 0


def _rollback(args: argparse.Namespace) -> int:
    try:
        result = rollback_bundle(runtime_dir=args.runtime_dir)
    except ActivationError as exc:
        print(f"rollback failed: {exc}", file=sys.stderr)
        return 1
    print(f"active_version: {result.to_version}")
    print(f"previous_version: {result.previous_version or 'none'}")
    return 0


def _status(args: argparse.Namespace) -> int:
    payload = activation_status(runtime_dir=args.runtime_dir)
    if args.json:
        print(json.dumps(payload, indent=2, ensure_ascii=False))
        return 0
    print(f"active_version: {payload['active_version'] or 'none'}")
    print(f"active_bundle: {payload['active_bundle'] or 'none'}")
    print(f"previous_version: {payload['previous_version'] or 'none'}")
    for bundle in payload["bundles"]:
        flags = []
        if bundle.get("active"):
            flags.append("active")
        if bundle.get("previous"):
            flags.append("previous")
        detail = f" [{', '.join(flags)}]" if flags else ""
        print(f"  {bundle['version']}{detail}")
        if bundle.get("error"):
            print(f"    error: {bundle['error']}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = _Parser(
        prog="python -m astro_finance.events",
        description="Build and inspect the weekly StrikeHike events bundle.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    build = subparsers.add_parser("build", help="run every stage and write a bundle")
    build.add_argument("--out", type=Path, required=True, help="output directory")
    build.add_argument("--previous", type=Path, help="previous bundle directory")
    build.add_argument("--today", help="YYYY-MM-DD; defaults to the UTC date")
    build.add_argument(
        "--offline", type=Path, help="fixture root for sources that would use the network"
    )
    build.add_argument(
        "--sources",
        help="comma-separated source ids; defaults to every enabled source",
    )
    build.add_argument(
        "--log-level",
        default="info",
        choices=("debug", "info", "warning", "error"),
    )
    build.set_defaults(func=_build)

    validate = subparsers.add_parser("validate", help="verify a built bundle")
    validate.add_argument("bundle", type=Path)
    validate.set_defaults(func=_validate)

    report = subparsers.add_parser("report", help="print quality_report.md")
    report.add_argument("bundle", type=Path)
    report.set_defaults(func=_report)

    diff = subparsers.add_parser("diff", help="compare two bundle directories")
    diff.add_argument("old", type=Path)
    diff.add_argument("new", type=Path)
    diff.set_defaults(func=_diff)

    activate = subparsers.add_parser(
        "activate", help="download, verify and atomically activate a release"
    )
    activate.add_argument("--version", required=True, help="bundle release version")
    activate.add_argument(
        "--repo",
        default=DEFAULT_REPO,
        help=f"GitHub repository (default {DEFAULT_REPO})",
    )
    activate.add_argument("--runtime-dir", type=Path)
    activate.add_argument(
        "--release-dir",
        type=Path,
        help="local directory with the three release assets (tests/offline use)",
    )
    activate.set_defaults(func=_activate)

    rollback = subparsers.add_parser(
        "rollback", help="switch the current pointer back to the previous bundle"
    )
    rollback.add_argument("--runtime-dir", type=Path)
    rollback.set_defaults(func=_rollback)

    status = subparsers.add_parser(
        "status", help="show the active, previous and retained bundles"
    )
    status.add_argument("--runtime-dir", type=Path)
    status.add_argument("--json", action="store_true")
    status.set_defaults(func=_status)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    try:
        args = parser.parse_args(argv)
    except SystemExit as exc:
        return int(exc.code)
    try:
        return int(args.func(args))
    except Exception as exc:  # pragma: no cover - CLI boundary
        print(
            f"error: {redact_secrets(f'{type(exc).__name__}: {exc}')}",
            file=sys.stderr,
        )
        return 1


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
