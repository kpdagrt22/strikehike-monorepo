"""The smoke bundle CI builds is the one a local stack builds (the P17 gap).

The Playwright @deploy test "Culture/Religion shows the new computed and
curated dates" failed on local stacks (P20, W48, S3 reports) because the local
runtime still served a bundle built before the Culture/Religion sources
existed. CI and a local stack now both run scripts/smoke_events_bundle.py.
"""

from __future__ import annotations

import sqlite3
from datetime import date

from astro_finance.events.store import current_bundle_dir
from scripts.smoke_events_bundle import build_smoke_bundle, main

# The day the gap was closed; the curated festivals were verified on 13 Nov.
DAY = date(2026, 11, 16)


def _active_names(bundle_dir, theme: str) -> set[str]:
    connection = sqlite3.connect(bundle_dir / "events.sqlite")
    try:
        rows = connection.execute(
            "SELECT name FROM events WHERE theme = ? AND kind = 'upcoming' "
            "AND status IN ('scheduled', 'tentative')",
            (theme,),
        ).fetchall()
    finally:
        connection.close()
    return {row[0] for row in rows}


def test_the_smoke_bundle_carries_the_culture_dates_the_deploy_gate_expects(tmp_path):
    bundle_dir, version, counts = build_smoke_bundle(
        tmp_path / "build", tmp_path / "runtime", today=DAY
    )
    assert len(version) == 16
    # The pointer the backend reads (EVENTS_RUNTIME_DIR) resolves to this bundle.
    assert current_bundle_dir(tmp_path / "runtime") == bundle_dir
    names = _active_names(bundle_dir, "Culture/Religion")
    # Computed (Christmas, Chinese New Year) and curated (Holi) dates, the
    # three the p17 @deploy test named when it failed locally.
    assert {"Christmas 2026", "Chinese New Year 2027", "Holi 2027"} <= names
    assert counts["Culture/Religion"] == len(names)
    assert counts["Finance"] >= 5 and counts["Science"] >= 2


def test_the_cli_prints_the_bundle_and_the_counts(tmp_path, capsys):
    code = main(
        [
            "--out",
            str(tmp_path / "build"),
            "--runtime",
            str(tmp_path / "runtime"),
            "--today",
            DAY.isoformat(),
        ]
    )
    assert code == 0
    out = capsys.readouterr().out
    assert "smoke bundle: " in out
    assert "Culture/Religion=" in out
    assert "::warning::" not in out
    assert (tmp_path / "runtime" / "current").read_text("utf-8").strip().endswith("bundle")
