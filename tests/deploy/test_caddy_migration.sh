#!/usr/bin/env bash
# scripts/caddy_migrate.sh must leave the host Caddyfile byte-identical to its
# backup when the pull fails, and migrate cleanly when the pull succeeds.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MIGRATE="$ROOT/scripts/caddy_migrate.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Isolate git from the machine's config.
export HOME="$WORK/home"
export GIT_CONFIG_NOSYSTEM=1
export GIT_AUTHOR_NAME=ci GIT_AUTHOR_EMAIL=ci@example.invalid
export GIT_COMMITTER_NAME=ci GIT_COMMITTER_EMAIL=ci@example.invalid
mkdir -p "$HOME"

STRIKEHIKE_SITE=$'strikehike.com, www.strikehike.com {\n\tencode gzip\n\treverse_proxy frontend:3000\n}\n'
THISISKP_BLOCK=$'# BEGIN THISISKP.IN\nwww.thisiskp.in {\n\tredir https://thisiskp.in{uri} permanent\n}\n\nthisiskp.in {\n\tencode zstd gzip\n\treverse_proxy 172.17.0.1:4321\n}\n# END THISISKP.IN\n'
printf '%s' "$THISISKP_BLOCK" > "$WORK/expected-snippet"

fail() {
  echo "not ok - $*" >&2
  exit 1
}
ok() { echo "ok - $*"; }

# A bare remote whose main has the old layout (tracked root Caddyfile) and the helper.
new_remote() {
  local name="$1"
  git init -q --bare -b main "$WORK/$name.git"
  git init -q -b main "$WORK/$name-seed"
  mkdir -p "$WORK/$name-seed/scripts"
  printf '%s' "$STRIKEHIKE_SITE" > "$WORK/$name-seed/Caddyfile"
  cp "$ROOT/scripts/caddy_snippet.py" "$WORK/$name-seed/scripts/"
  git -C "$WORK/$name-seed" add -A
  git -C "$WORK/$name-seed" commit -q -m "old layout"
  git -C "$WORK/$name-seed" remote add origin "$WORK/$name.git"
  git -C "$WORK/$name-seed" push -q origin main
}

# A host checkout whose Caddyfile carries thisiskp's appended block (a local edit).
new_host() {
  local name="$1"
  git clone -q "$WORK/$name.git" "$WORK/$name-host"
  printf '\n%s' "$THISISKP_BLOCK" >> "$WORK/$name-host/Caddyfile"
  cp -p "$WORK/$name-host/Caddyfile" "$WORK/$name-before"
}

# Runs the migration as the deploy does; sets $status and leaves a log.
run_migrate() {
  local name="$1"
  mkdir -p "$WORK/$name-home"
  status=0
  (cd "$WORK/$name-host" && HOME="$WORK/$name-home" bash "$MIGRATE") \
    > "$WORK/$name.log" 2>&1 || status=$?
}

assert_restored() {
  local name="$1"
  local host="$WORK/$name-host"
  local backups=("$WORK/$name-home"/caddy-backups/Caddyfile.*)
  [ "$status" -ne 0 ] || fail "$name: the migration should fail when the pull fails"
  [ "${#backups[@]}" -eq 1 ] && [ -f "${backups[0]}" ] || fail "$name: expected one backup"
  cmp -s "$host/Caddyfile" "${backups[0]}" \
    || fail "$name: ./Caddyfile is not byte-identical to the backup"
  cmp -s "$host/Caddyfile" "$WORK/$name-before" \
    || fail "$name: ./Caddyfile differs from the file before the deploy"
  cmp -s "$host/deploy/caddy/sites/thisiskp.caddy" "$WORK/expected-snippet" \
    || fail "$name: the extracted snippet should stay in place"
  grep -q "^::error::git pull --ff-only failed" "$WORK/$name.log" \
    || fail "$name: missing the pull ::error::"
  grep -q "^Restored Caddyfile from " "$WORK/$name.log" \
    || fail "$name: missing the restore message"
}

# 1. The remote was rewritten: the pull cannot fast-forward.
new_remote diverged
new_host diverged
git -C "$WORK/diverged-seed" commit -q --amend -m "rewritten history"
git -C "$WORK/diverged-seed" push -q --force origin main
git -C "$WORK/diverged-host" fetch -q origin main
run_migrate diverged
assert_restored diverged
ok "rewritten remote: pull fails, ./Caddyfile is byte-identical to the backup"

# 2. The remote is unreachable: the pull's fetch fails.
new_remote unreachable
new_host unreachable
git -C "$WORK/unreachable-host" remote set-url origin "$WORK/missing.git"
run_migrate unreachable
assert_restored unreachable
ok "unreachable remote: pull fails, ./Caddyfile is byte-identical to the backup"

# 3. The pull succeeds: main moves the Caddyfile under deploy/caddy.
new_remote success
new_host success
seed="$WORK/success-seed"
git -C "$seed" rm -q Caddyfile
mkdir -p "$seed/deploy/caddy/sites"
printf '%s\nimport sites/*.caddy\n' "$STRIKEHIKE_SITE" > "$seed/deploy/caddy/Caddyfile"
: > "$seed/deploy/caddy/sites/.gitkeep"
printf 'deploy/caddy/sites/*.caddy\n' > "$seed/.gitignore"
git -C "$seed" add -A
git -C "$seed" commit -q -m "new layout"
git -C "$seed" push -q origin main
host="$WORK/success-host"
git -C "$host" fetch -q origin main
run_migrate success
[ "$status" -eq 0 ] || { cat "$WORK/success.log" >&2; fail "success: the migration failed"; }
[ ! -e "$host/Caddyfile" ] || fail "success: the root Caddyfile should be gone after the pull"
cmp -s "$host/deploy/caddy/sites/thisiskp.caddy" "$WORK/expected-snippet" \
  || fail "success: the snippet is not the marked block"
[ "$(git -C "$host" rev-parse HEAD)" = "$(git -C "$host" rev-parse origin/main)" ] \
  || fail "success: HEAD is not origin/main"
[ -z "$(git -C "$host" status --porcelain)" ] || fail "success: the working tree is not clean"
! grep -q "Restored Caddyfile" "$WORK/success.log" || fail "success: restored after a good pull"
ok "successful pull: block moved to sites/thisiskp.caddy, root Caddyfile gone, tree clean"

# 4. An already-migrated host: no backup, the pull still runs.
rm -rf "$WORK/success-home"
run_migrate success
[ "$status" -eq 0 ] || { cat "$WORK/success.log" >&2; fail "migrated: the migration failed"; }
[ -z "$(ls -A "$WORK/success-home/caddy-backups")" ] || fail "migrated: no backup expected"
cmp -s "$host/deploy/caddy/sites/thisiskp.caddy" "$WORK/expected-snippet" \
  || fail "migrated: the snippet changed"
ok "already-migrated host: no backup, snippet untouched, pull succeeds"
