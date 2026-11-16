# Restore on a new host

The backup stamps are directory trees: `analytics.sqlite`, `digest.sqlite`,
`historical_events.db` and `events/` (bundles + `current` pointer). A stamp is
owner-only on the host and contains subscriber emails from `digest.sqlite`.

## Drill (this machine)

1. Pick a stamp: `~/strikehike-backups/<UTC stamp>`.
2. Restore into a scratch directory:
   ```
   bash scripts/restore_runtime.sh --from ~/strikehike-backups/<stamp> --to /tmp/restored
   ```
   The script refuses `--project strikehike-chrono`, runs `PRAGMA integrity_check` on every database, writes
   `restore-report.json` and compares row counts with the source.
3. Run the backend against it (no production volume):
   ```
   PYTHONPATH=src ANALYTICS_DB=/tmp/restored/analytics.sqlite \
   EVENTS_RUNTIME_DIR=/tmp/restored/events \
   HISTORICAL_EVENTS_DB=/tmp/restored/historical_events.db \
   .venv/bin/python -m uvicorn api_server:app --host 127.0.0.1 --port 8011
   ```
4. Check `/api/v1/events/upcoming` and `/api/v1/regime/macro-history` answer 200.
5. Start the stack only after the check passes.

## Total loss on a new host

1. Provision the host and install Docker + compose.
2. Clone the repository and check out the live commit.
3. Create the compose volumes; **do not** mount `caddy-data` for the restore.
4. Copy the newest stamp (from the owner's off-host storage, pending) to the host.
5. Restore into the `historical-data` volume:
   ```
   docker run --rm -v strikehike-chrono_historical-data:/data \
     -v /path/to/stamp:/backup:ro alpine sh -c 'cp -a /backup/. /data/'
   ```
6. Start the stack, then run `node scripts/verify-live.mjs --base-url=... --expect-sha=...`.
7. Compare `restore-report.json` row counts with the last known values; check `/api/v1/events/upcoming` and
   `/api/v1/regime/macro-history`.

Caddy configuration and its data are separate; this runbook never copies or mounts them.

## Off-host

The 14 local stamps live on the same host as the data. A new host needs a copy from the owner's storage choice;
that decision and its monthly cost are in `reports/questions.md`.
