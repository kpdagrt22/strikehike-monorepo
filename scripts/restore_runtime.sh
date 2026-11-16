#!/usr/bin/env bash
# RESTORE-drill: restore one backup stamp and prove it is readable.
#
#   bash scripts/restore_runtime.sh --from ~/strikehike-backups/<stamp> --to /tmp/restored
#
# Copies the sqlite files and the events directory, runs PRAGMA integrity_check
# on every database and writes a row count per table. The destination must not
# be the live runtime directory. Caddy data is never touched.
#
# The restored digest.sqlite holds subscriber emails: owner-only, like the backup.
set -euo pipefail
umask 077

FROM=""
TO=""
PROJECT=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --from) FROM="$2"; shift 2 ;;
    --to) TO="$2"; shift 2 ;;
    --project) PROJECT="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

[ -n "$FROM" ] && [ -n "$TO" ] || { echo "--from and --to are required" >&2; exit 2; }
[ "$PROJECT" != "strikehike-chrono" ] || { echo "refusing the production project name" >&2; exit 1; }
[ -d "$FROM" ] || { echo "backup missing: $FROM" >&2; exit 1; }
case "$TO" in
  /app/data/runtime|*"/strikehike-chrono"*) echo "refusing the live runtime path" >&2; exit 1 ;;
esac

mkdir -p "$TO"
cp -a "$FROM"/. "$TO"/

PYTHON_BIN="${PYTHON_BIN:-python3}"
to_native() {
  if command -v cygpath >/dev/null 2>&1; then cygpath -w "$1"; else printf '%s' "$1"; fi
}

"$PYTHON_BIN" - "$(to_native "$FROM")" "$(to_native "$TO")" <<'PY'
import json
import pathlib
import sqlite3
import sys

source = pathlib.Path(sys.argv[1])
restored = pathlib.Path(sys.argv[2])
report = {"databases": {}, "integrity": "ok"}

for db in ["analytics.sqlite", "digest.sqlite", "historical_events.db"]:
    path = restored / db
    if not path.exists():
        report["databases"][db] = {"missing": True}
        continue
    with sqlite3.connect(path) as con:
        check = con.execute("PRAGMA integrity_check").fetchone()[0]
        if check != "ok":
            report["integrity"] = f"{db}: {check}"
        tables = [row[0] for row in con.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        )]
        report["databases"][db] = {
            table: con.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]
            for table in tables
        }

if report["integrity"] != "ok":
    print(json.dumps(report, indent=2))
    sys.exit(report["integrity"])

# Compare with the source counts when the source databases are readable.
mismatch = []
for db, counts in report["databases"].items():
    source_db = source / db
    if counts.get("missing") or not source_db.exists():
        continue
    with sqlite3.connect(source_db) as con:
        for table, count in counts.items():
            rows = con.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]
            if rows != count:
                mismatch.append(f"{db}.{table}: {rows} -> {count}")
if mismatch:
    print(json.dumps({"mismatch": mismatch}, indent=2))
    sys.exit(1)

(restored / "restore-report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
print(json.dumps(report, indent=2))
PY

[ -f "$TO/events/current" ] || echo "note: no events/current pointer in this stamp"
echo "restore: $TO"
