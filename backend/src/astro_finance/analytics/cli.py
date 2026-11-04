"""Owner-only analytics commands."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from .store import AnalyticsStore


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="StrikeHike analytics operations")
    parser.add_argument("--db", type=Path, default=None, help="SQLite path")
    sub = parser.add_subparsers(dest="command", required=True)

    stats = sub.add_parser("stats")
    stats.add_argument("--week", required=True, help="YYYY-Www")

    delete = sub.add_parser("delete")
    delete.add_argument("--aid", required=True)

    feedback = sub.add_parser("feedback")
    feedback_sub = feedback.add_subparsers(dest="feedback_command", required=True)
    listing = feedback_sub.add_parser("list")
    listing.add_argument("--since", default=None, help="YYYY-MM-DD")

    args = parser.parse_args(argv)
    store = AnalyticsStore(args.db) if args.db else AnalyticsStore()
    try:
        if args.command == "stats":
            payload = store.stats_week(args.week)
        elif args.command == "delete":
            payload = {"deleted": store.delete_aid(args.aid)}
        else:
            payload = {"feedback": store.feedback_rows(args.since)}
    finally:
        store.close()
    print(json.dumps(payload, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
