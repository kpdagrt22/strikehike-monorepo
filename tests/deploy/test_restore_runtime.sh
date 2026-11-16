#!/usr/bin/env bash
# scripts/restore_runtime.sh must restore a stamp, pass integrity_check, keep
# row counts equal and refuse the production project name.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BACKUP="$ROOT/scripts/backup_runtime.sh"
RESTORE="$ROOT/scripts/restore_runtime.sh"
PYTHON="${PYTHON:-python3}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

native() {
  if command -v cygpath >/dev/null 2>&1; then cygpath -w "$1"; else printf '%s' "$1"; fi
}

RUNTIME="$WORK/runtime"
HOME_DIR="$WORK/home"
mkdir -p "$RUNTIME/analytics" "$RUNTIME/events/bundles/b1" "$HOME_DIR"

"$PYTHON" - "$(native "$RUNTIME")" <<'PY'
import pathlib
import sqlite3
import sys
runtime = pathlib.Path(sys.argv[1])
for name in ["analytics/analytics.sqlite", "analytics/digest.sqlite", "historical_events.db"]:
    with sqlite3.connect(runtime / name) as con:
        con.execute("CREATE TABLE marker(value TEXT)")
        for i in range(7):
            con.execute("INSERT INTO marker VALUES (?)", (f"v{i}",))
        con.commit()
PY
printf '%s\n' '{"bundle":"b1"}' > "$RUNTIME/events/bundles/b1/bundle.json"
printf '%s\n' 'bundles/b1' > "$RUNTIME/events/current"

HOME="$HOME_DIR" PYTHON_BIN="$PYTHON" BACKUP_STAMP="2026-11-16T00:00:00Z" \
  bash "$BACKUP" --runtime-dir "$RUNTIME" --dest "$HOME_DIR/strikehike-backups" >/dev/null

RESTORED="$WORK/restored"
PYTHON_BIN="$PYTHON" bash "$RESTORE" \
  --from "$HOME_DIR/strikehike-backups/2026-11-16T00:00:00Z" --to "$RESTORED" >/dev/null

[ -f "$RESTORED/restore-report.json" ] || { echo "restore report missing" >&2; exit 1; }
[ -f "$RESTORED/events/bundles/b1/bundle.json" ] || { echo "events missing" >&2; exit 1; }

"$PYTHON" - "$(native "$RESTORED")" <<'PY'
import json
import pathlib
import sqlite3
import sys
root = pathlib.Path(sys.argv[1])
report = json.loads((root / "restore-report.json").read_text())
assert report["integrity"] == "ok", report
for name in ["analytics.sqlite", "digest.sqlite", "historical_events.db"]:
    assert report["databases"][name]["marker"] == 7, report["databases"][name]
    with sqlite3.connect(root / name) as con:
        assert con.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
PY

if PYTHON_BIN="$PYTHON" bash "$RESTORE" --from "$RESTORED" --to "$WORK/no" \
  --project strikehike-chrono >/dev/null 2>&1; then
  echo "production project name was not refused" >&2
  exit 1
fi

echo "restore drill: integrity ok, row counts equal, events kept, production name refused"
