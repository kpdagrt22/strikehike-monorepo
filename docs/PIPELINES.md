# Pipelines

Every scheduled or dispatched workflow in this repository. Names are listed; secret **values** never are.
Times are UTC and IST (Asia/Kolkata).

| Workflow | What it updates | Schedule (UTC / IST) | Inputs | Secret/variable names | Guards | On failure | Who acts |
|---|---|---|---|---|---|---|---|
| `events-weekly.yml` | Events bundle, model decision, published week data | Sun 21:30 / Mon 03:00 | `today`, `build_only`, `macro_unchanged_reason` | `FRED_API_KEY`, `LIGHTSAIL_HOST`, `LIGHTSAIL_USERNAME`, `LIGHTSAIL_SSH_KEY`, `LIGHTSAIL_APP_DIR` | Gate suite before activation; activation self-check; rollback pointer; `build_only` never publishes | Job red; last bundle stays active; job summary says which stage failed | Claude checks; owner for a data decision |
| `roundup-draft.yml` | Next week's roundup draft JSON | Sat 04:30 / Sat 10:00 | `week` | none | Refuses a stale Regime reading; writes a draft, never approves | Job red; no draft | Owner approves the draft |
| `digest-send.yml` | Weekly email sends and previews | Mon 01:30 / Mon 07:00 | `week`, `dry_run`, `preview` | `RESEND_API_KEY`, `DIGEST_TOKEN_SECRET`, `DIGEST_ENABLED`, `DIGEST_POSTAL_ADDRESS`, `DIGEST_REPLY_TO`, `DIGEST_PREVIEW_TO`, `DIGEST_AUTOSEND` (var), `LIGHTSAIL_*` | Autosend is off unless `DIGEST_AUTOSEND=1`; approved week required; idempotent send ledger; preview is a separate secret path | Job red; no send recorded | Claude dispatches W48 manually; autosend from W49 |
| `deps-watch.yml` | Nothing; advisory summary | Mon 06:00 / Mon 11:30 | none | none | Runtime-only npm audit and pip-audit; no issue creation | Never red on a finding; summary says if the audit could not run | Owner/Claude read the summary |
| `fresh-watch.yml` | Nothing; public freshness table | Daily 02:30 / 08:00 | none | none | Public GETs only; three retries; thresholds per check | **Red**; GitHub emails the owner | Owner checks the stale source |
| `perf-measure.yml` | Nothing; Lighthouse JSON artifact and table | Tue 03:30 / Tue 09:00 | `base_url`, `runs`, `form_factor` | none | Pinned Lighthouse; one retry per run; artifact 30 days | Red only when a Lighthouse run cannot complete | Claude reads the trend |
| `pipeline-health.yml` | Nothing; scheduled-run table | Daily 03:15 / 08:45 | none | `github.token` | Checks newest completed scheduled run per workflow; summary written on pass or fail | **Red** on a missing/stale/failed scheduled run | Claude/owner checks the named workflow |
| `deploy-lightsail.yml` | Production stack | Push to `main`, or dispatch from `main` | `rehearse_rollback` | `LIGHTSAIL_*`, `GROWTH_EXPORT_TOKEN`, `RESEND_API_KEY`, `DIGEST_TOKEN_SECRET`, `DIGEST_ENABLED`, `DIGEST_POSTAL_ADDRESS`, `DIGEST_REPLY_TO`, `INDEXNOW_KEY`, `CSP_MODE` | Backend, frontend, smoke and Caddy tests; pre-deploy backup; rollback images; live verify step | Deploy stops/rolls back; job red | Claude checks the live verify |
| `macro-ingestion.yml` | Macro source data | Dispatch only | none | `FRED_API_KEY` | Source validation before write | Job red; previous data stays | Claude/owner |
| `reseed-historical-events.yml` | Historical events seed | Dispatch only | none | `LIGHTSAIL_*` | Backup + explicit dispatch | Job red; seed untouched | Claude/owner |

## Rules

- Every pipeline writes its job summary whether the check passes or fails; the health and freshness checks capture
  the exit code, write the summary, then exit with that code.
- Checkout steps use `persist-credentials: false` unless the job must push.
- Scheduled failures are surfaced by `pipeline-health.yml` (daily) as well as by GitHub's own red run and email.
- `DIGEST_AUTOSEND` stays unset until W49; W48 is a manual dispatch.
