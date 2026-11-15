#!/usr/bin/env bash
# BACKUP-1: consistent copies of the runtime data that lives only on the host.
#
#   bash scripts/backup_runtime.sh                 # deploy path (docker compose)
#   bash scripts/backup_runtime.sh --runtime-dir DIR --dest DIR   # test/local
#
# SQLite files are copied with the sqlite3 backup API. The events runtime
# (bundles + current pointer) is copied as a directory. Caddy data and logs are
# never touched. The newest 14 stamps are kept.
#
# digest.sqlite holds subscriber emails, so every copy is owner-only (umask 077,
# backup root 0700).
set -euo pipefail
umask 077

RUNTIME_DIR=""
DEST_ROOT="${HOME}/strikehike-backups"
KEEP=14
PROJECT="${COMPOSE_PROJECT_NAME:-strikehike-chrono}"
PYTHON_BIN="${PYTHON_BIN:-python3}"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --runtime-dir) RUNTIME_DIR="$2"; shift 2 ;;
    --dest) DEST_ROOT="$2"; shift 2 ;;
    --keep) KEEP="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

STAMP="${BACKUP_STAMP:-$(date -u +%Y%m%dT%H%M%SZ)}"
DEST="${DEST_ROOT}/${STAMP}"

# Git Bash hands POSIX paths to a Windows Python; convert only for local mode.
to_native() {
  if command -v cygpath >/dev/null 2>&1; then cygpath -w "$1"; else printf '%s' "$1"; fi
}

# --- consistent sqlite copies, inside the runtime or inside the container ---
backup_python() {
  local runtime="$1"
  local out="$2"
  "$PYTHON_BIN" - "$runtime" "$out" <<'PY'
import pathlib
import shutil
import sqlite3
import sys

runtime = pathlib.Path(sys.argv[1])
out = pathlib.Path(sys.argv[2])
out.mkdir(parents=True, exist_ok=True)

sources = [
    runtime / "analytics" / "analytics.sqlite",
    runtime / "analytics" / "digest.sqlite",
    runtime / "historical_events.db",
]
for source in sources:
    if not source.exists():
        continue
    target = out / source.name
    with sqlite3.connect(source) as src, sqlite3.connect(target) as dst:
        src.backup(dst)

# Bundles and the active pointer are the events runtime; no caddy logs live
# under this directory.
events = runtime / "events"
if events.exists():
    shutil.copytree(events, out / "events")
print(f"backed up into {out}")
PY
}

if [ -n "$RUNTIME_DIR" ]; then
  [ -d "$RUNTIME_DIR" ] || { echo "runtime dir missing: $RUNTIME_DIR" >&2; exit 1; }
  mkdir -p "$DEST"
  backup_python "$(to_native "$RUNTIME_DIR")" "$(to_native "$DEST")"
else
  CID="$(docker compose -p "$PROJECT" ps -q backend 2>/dev/null || true)"
  if [ -z "$CID" ]; then
    echo "no backend container; nothing to back up yet"
    exit 0
  fi
  mkdir -p "$DEST"
  INNER="/app/data/runtime/backups/${STAMP}"
  if ! docker compose -p "$PROJECT" exec -T backend python - "$INNER" <<'PY'
import pathlib
import shutil
import sqlite3
import sys

runtime = pathlib.Path("/app/data/runtime")
out = pathlib.Path(sys.argv[1])
out.mkdir(parents=True, exist_ok=True)
for source in [
    runtime / "analytics" / "analytics.sqlite",
    runtime / "analytics" / "digest.sqlite",
    runtime / "historical_events.db",
]:
    if not source.exists():
        continue
    target = out / source.name
    with sqlite3.connect(source) as src, sqlite3.connect(target) as dst:
        src.backup(dst)
events = runtime / "events"
if events.exists():
    shutil.copytree(events, out / "events")
PY
  then
    echo "sqlite backup inside the container failed" >&2
    rm -rf "$DEST"
    exit 1
  fi
  if ! docker cp "${CID}:${INNER}/." "$DEST/"; then
    echo "copying the backup out of the container failed" >&2
    docker compose -p "$PROJECT" exec -T backend rm -rf "$INNER" || true
    rm -rf "$DEST"
    exit 1
  fi
  docker compose -p "$PROJECT" exec -T backend rm -rf "$INNER" || true
fi

# docker cp keeps the container's file modes; make the whole copy owner-only.
chmod 700 "$DEST_ROOT" "$DEST"
chmod -R go-rwx "$DEST"

# --- a copy must have bytes, and every sqlite file must pass quick_check ---
if find "$DEST" -type f -size 0 | grep -q .; then
  echo "empty file in backup: $(find "$DEST" -type f -size 0 | head -n 1)" >&2
  exit 1
fi
for db in "$DEST"/*.sqlite "$DEST"/*.db; do
  [ -f "$db" ] || continue
  "$PYTHON_BIN" - "$(to_native "$db")" <<'PY'
import sqlite3
import sys
with sqlite3.connect(sys.argv[1]) as con:
    result = con.execute("PRAGMA quick_check").fetchone()[0]
    if result != "ok":
        sys.exit(f"sqlite quick_check failed for {sys.argv[1]}: {result}")
PY
done

echo "backup: $DEST"
du -sh "$DEST" 2>/dev/null || true

# --- keep the newest KEEP stamps ---
find "$DEST_ROOT" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' \
  | sort -nr \
  | tail -n +"$((KEEP + 1))" \
  | cut -d' ' -f2- \
  | xargs -r rm -rf
