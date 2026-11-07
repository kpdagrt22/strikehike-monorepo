#!/usr/bin/env bash
# Pull step of the Lightsail deploy, run from the monorepo root after
# `git fetch origin main`. The deploy takes this file from origin/main because
# the working tree has not been pulled yet.
#
# 1. Back up the host's root Caddyfile to ~/caddy-backups.
# 2. Move thisiskp's locally appended block into deploy/caddy/sites/.
# 3. Restore the tracked Caddyfile and pull.
#
# Any exit between restoring the tracked Caddyfile and a successful pull copies
# the backup back, so a failed pull leaves the host as it was. The extracted
# snippet stays: nothing reads it until the new layout is mounted.
# Nothing here prints the block.
set -euo pipefail

BACKUP=""
RESTORE_ON_EXIT=0

restore_caddyfile() {
  if [ "$RESTORE_ON_EXIT" -eq 1 ]; then
    cp -p "$BACKUP" Caddyfile
    echo "Restored Caddyfile from $BACKUP; the host is as it was before this deploy."
  fi
}
trap restore_caddyfile EXIT
trap 'exit 1' HUP INT TERM

mkdir -p "$HOME/caddy-backups"
if [ -f Caddyfile ]; then
  BACKUP="$HOME/caddy-backups/Caddyfile.$(date -u +%Y%m%dT%H%M%SZ)"
  cp -p Caddyfile "$BACKUP"
  echo "Backed up Caddyfile to $BACKUP"
fi

if [ -f Caddyfile ] && grep -qF "# BEGIN THISISKP.IN" Caddyfile; then
  mkdir -p deploy/caddy/sites
  SNIPPET_TMP="$(mktemp)"
  HELPER_TMP="$(mktemp)"
  git show origin/main:scripts/caddy_snippet.py > "$HELPER_TMP"
  if python3 "$HELPER_TMP" Caddyfile > "$SNIPPET_TMP"; then
    mv "$SNIPPET_TMP" deploy/caddy/sites/thisiskp.caddy
    rm -f "$HELPER_TMP"
  else
    rm -f "$SNIPPET_TMP" "$HELPER_TMP"
    echo "::error::Could not extract the thisiskp.in Caddy block; the old stack is unchanged."
    exit 1
  fi
  RESTORE_ON_EXIT=1
  git checkout -- Caddyfile
  echo "Migrated the thisiskp.in block to deploy/caddy/sites/thisiskp.caddy."
fi

if ! git pull --ff-only origin main; then
  echo "::error::git pull --ff-only failed; no images were built and the old stack is still serving."
  exit 1
fi
RESTORE_ON_EXIT=0
