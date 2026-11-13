"""Command line for the append-only ledger."""

from __future__ import annotations

import argparse
import json
import sys

from .store import LedgerError, append_entry, verify_file


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m astro_finance.ledger",
        description="Append or verify the public StrikeHike ledger.",
    )
    commands = parser.add_subparsers(dest="command", required=True)

    append = commands.add_parser("append", help="append one approved week")
    append.add_argument("--week", required=True, help="ISO week, e.g. 2026-W46")
    append.add_argument(
        "--dry-run",
        action="store_true",
        help="build and print the line without writing it",
    )
    append.add_argument(
        "--correction-of",
        type=int,
        default=None,
        help="append a correction to this seq instead of a roundup line",
    )
    append.add_argument(
        "--reason",
        default=None,
        help="short plain reason for a correction",
    )
    append.add_argument(
        "--published-at",
        default=None,
        help="UTC ISO timestamp; defaults to now",
    )
    append.add_argument("--path", default=None, help="ledger file override")

    verify = commands.add_parser("verify", help="recompute every hash and link")
    verify.add_argument("--path", default=None, help="ledger file override")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        if args.command == "append":
            entry = append_entry(
                args.week,
                path=args.path,
                published_at=args.published_at,
                correction_of=args.correction_of,
                reason=args.reason,
                dry_run=args.dry_run,
            )
            print(
                json.dumps(
                    entry,
                    ensure_ascii=False,
                    separators=(",", ":"),
                    sort_keys=True,
                )
            )
            if args.dry_run:
                print("dry run: not written")
            else:
                print(f"appended seq {entry['seq']} for {entry['week']}")
            return 0

        entries = verify_file(args.path)
        print(f"ledger ok: {len(entries)} entries")
        return 0
    except LedgerError as exc:
        print(f"ledger error: {exc}", file=sys.stderr)
        return 1
