"""Build the offline smoke events bundle and point a runtime directory at it.

The CI smoke and full-suite jobs (deploy-lightsail.yml) run this, and a local
stack should too. The Playwright @deploy set (p17 Culture/Religion, upcoming,
events) reads whatever bundle the backend serves: a local runtime left on an
older bundle fails tests that CI passes. That was the "P17 local-bundle gap"
in the P20, W48 and S3 reports: the local active bundle predated the computed
Culture/Religion source and the curated festival file, so it had no
Christmas 2026, Chinese New Year 2027 or Holi 2027.

From backend/:

    PYTHONPATH="src:." python -m scripts.smoke_events_bundle \\
        --out /tmp/smoke-events-build --runtime /tmp/smoke-events
    EVENTS_RUNTIME_DIR=/tmp/smoke-events LOAD_ML_MODELS=0 \\
        uvicorn api_server:app --host 127.0.0.1 --port 8010

The bundle comes from the committed sources: the offline FRED fixtures, the
computed astronomy and Culture/Religion sources, the curated TOML files and
the historical seed, built for today's date. It is a test build
(publishable: false); production activates the weekly release instead.
"""

from __future__ import annotations

import argparse
import tempfile
from datetime import date, datetime, time, timezone
from pathlib import Path
from typing import Sequence

from astro_finance.events.pipeline import PipelineOptions, run_pipeline
from astro_finance.events.store import upcoming_totals_by_theme

BACKEND = Path(__file__).resolve().parents[1]
OFFLINE = BACKEND / "tests" / "events" / "fixtures" / "offline"


def build_smoke_bundle(
    out_dir: Path, runtime_dir: Path, *, today: date | None = None
) -> tuple[Path, str, dict[str, int]]:
    """Build the bundle into ``out_dir`` and write ``runtime_dir/current``."""

    if today is None:
        now = datetime.now(timezone.utc)
    else:
        now = datetime.combine(today, time(12, 0), tzinfo=timezone.utc)
    result = run_pipeline(
        PipelineOptions(
            out_dir=out_dir,
            offline_dir=OFFLINE,
            today=now.date(),
            now=now,
            created_at=now,
            execution_id="smoke-bundle",
        )
    )
    runtime_dir.mkdir(parents=True, exist_ok=True)
    (runtime_dir / "current").write_text(
        str(result.bundle_dir) + "\n", encoding="utf-8"
    )
    counts = upcoming_totals_by_theme(
        result.bundle_dir / "events.sqlite", None, today=now.date()
    )
    return result.bundle_dir, result.bundle_version, counts


def main(argv: Sequence[str] | None = None) -> int:
    temp = Path(tempfile.gettempdir())
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", type=Path, default=temp / "smoke-events-build")
    parser.add_argument("--runtime", type=Path, default=temp / "smoke-events")
    parser.add_argument("--today", type=date.fromisoformat, default=None)
    args = parser.parse_args(argv)

    bundle_dir, version, counts = build_smoke_bundle(
        args.out, args.runtime, today=args.today
    )
    print(f"smoke bundle: {bundle_dir} ({version})")
    print(f"runtime pointer: {args.runtime / 'current'}")
    print(
        "upcoming by theme: "
        + ", ".join(f"{theme}={count}" for theme, count in counts.items())
    )
    if counts.get("Finance", 0) < 5 or counts.get("Science", 0) < 2:
        print(
            "::warning::Smoke fixture is running out of future dates: "
            "refresh backend/tests/events/fixtures/offline"
        )
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
