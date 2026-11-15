#!/usr/bin/env bash
# scripts/backup_runtime.sh must copy every runtime sqlite file with a valid
# sqlite copy, keep the events directory, and retain only the newest 14 stamps.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT="$ROOT/scripts/backup_runtime.sh"
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
        con.execute("INSERT INTO marker VALUES ('kept')")
        con.commit()
PY

printf '%s\n' '{"bundle":"b1"}' > "$RUNTIME/events/bundles/b1/bundle.json"
printf '%s\n' 'bundles/b1' > "$RUNTIME/events/current"

for i in $(seq -w 1 16); do
  HOME="$HOME_DIR" PYTHON_BIN="$PYTHON" BACKUP_STAMP="2026-11-15T00:00:${i}Z" \
    bash "$SCRIPT" --runtime-dir "$RUNTIME" --dest "$HOME_DIR/strikehike-backups" >/dev/null
done

LATEST="$HOME_DIR/strikehike-backups/2026-11-15T00:00:16Z"
[ -d "$LATEST" ] || { echo "latest stamp missing" >&2; exit 1; }
for name in analytics.sqlite digest.sqlite historical_events.db events/bundles/b1/bundle.json; do
  [ -s "$LATEST/$name" ] || { echo "missing or empty: $name" >&2; exit 1; }
done

"$PYTHON" - "$(native "$LATEST/analytics.sqlite")" <<'PY'
import sqlite3
import sys
with sqlite3.connect(sys.argv[1]) as con:
    assert con.execute("SELECT value FROM marker").fetchone()[0] == "kept"
PY

COUNT="$(find "$HOME_DIR/strikehike-backups" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')"
[ "$COUNT" = "14" ] || { echo "expected 14 stamps, found $COUNT" >&2; exit 1; }
[ ! -d "$HOME_DIR/strikehike-backups/2026-11-15T00:00:01Z" ] \
  || { echo "oldest stamp was not pruned" >&2; exit 1; }
[ ! -e "$RUNTIME/backups" ] || { echo "backup leaked into the runtime dir" >&2; exit 1; }
# Copies hold subscriber emails: owner-only on Linux (NTFS has no POSIX modes).
if [ "$(uname -s)" = "Linux" ]; then
  [ "$(stat -c %a "$LATEST")" = "700" ] || { echo "backup stamp is not 0700" >&2; exit 1; }
  [ "$(stat -c %a "$LATEST/digest.sqlite")" = "600" ] || { echo "digest copy is not 0600" >&2; exit 1; }
fi

echo "backup runtime: sqlite copies valid, events kept, 14 stamps retained"
