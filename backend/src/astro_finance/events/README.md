# Weekly events bundle

This package builds the read-only events bundle behind StrikeHike's upcoming
events view.  It is deliberately separate from the existing `historical_events`
SQLite store and from `regime/cases.py`: it reads the curated historical seed,
adds real scheduled dates from a small set of sources, merges the result with
the previous bundle, and publishes nothing unless every quality gate passes.

The architect reviews and merges.  This package owns the pipeline, the bundle
format, the gates, the read helpers, the release assets and the activation/
rollback commands.  The endpoint and UI are covered in the Read API section.

## Architecture

```text
backend/data/events/sources.toml ─┐
backend/data/historical_events.json├─> discovery ─> extraction ─> normalization
backend/data/events/curated/*.toml ┘        │            │
                                            │            └─ raw/<source>/… cache
                                            v
                              validation ─> deduplication ─> lifecycle
                                            │                  │
                                            │                  └─ previous bundle
                                            v
                            enrichment ─> theme classification ─> dataset
                                                                   │
                                    events.json + events.sqlite ───┤
                                                                   v
                                              quality gates ─> quality_report.*
                                                                   │
                                                        <out>/bundle/manifest.json
```

Every stage records one `StageRecord` in `<out>/runs/<execution_id>.jsonl`.
Rejected records go to `<out>/rejects.json` with their reasons; they are not
silently dropped.

## Stages

| Stage | Input | Output | Retries | Notes |
|---|---|---|---|---|
| `discovery` | `sources.toml` | enabled sources | 0 | `--sources` filters by id; unknown ids fail. |
| `extraction` | enabled sources | raw records | 2 | Each source caches its raw payload under `<out>/raw/<source_id>/`. |
| `normalization` | raw records | candidate events | 0 | NFC text, whitespace collapse, date/time/IANA parsing, stable ids. |
| `validation` | candidates | valid events | 0 | Required fields, themes, https URLs, active upcoming window, historical dates. |
| `deduplication` | valid events | unique events | 0 | Theme + normalised name + date; ±1 day only when both are all-day. |
| `lifecycle` | unique events + previous bundle | merged events | 0 | Append-only; see the lifecycle rules below. |
| `enrichment` | merged events | merged events | 0 | Adds `days_until` only. |
| `theme_classification` | merged events | merged events | 0 | Checks every event theme against its source's declared themes. |
| `dataset_creation` | merged events | `events.json`, `events.sqlite` | 2 | SQLite is built from the serialised `events.json`. |
| `quality_report` | dataset + gates | manifest and reports | 0 | Writes the final manifest and `publishable`. |

## Source registry

`sources.toml` is read with `tomllib`.  Each source declares `id`, `themes`,
`kind` (`api`, `computed`, `curated`, `historical`), `url`, `terms`, `rate_limit`,
`expected_freshness_days`, `reliability` (`high`, `medium`, `low`), `enabled`,
and `verification` (`verified`, `computed`, `curated`, `unverified`).

| Source | Kind | Themes | Terms / licence | Limit and freshness |
|---|---|---|---|---|
| `historical_curated` | historical | all five | The project's curated seed; dates are UTC calendar dates. | Local file; checked every run. |
| `fred_release_dates` | api | Finance | FRED, Federal Reserve Bank of St. Louis; attribution required ([FRED legal](https://fred.stlouisfed.org/legal/)). Dates only. | 2 requests/s, 20 s timeout, 3 retries, at most 5 pages; 7 days. |
| `astronomy_computed` | computed | Science | Swiss Ephemeris via `pyswisseph`, Moshier mode. `pyswisseph`/Swiss Ephemeris is AGPL-3.0 or commercially licensed; no ephemeris data is downloaded. | Local computation; 1 day. |
| `culture_computed` | computed | Culture/Religion | Anonymous Gregorian computus and Meeus' Julian computus; no liturgical data downloaded. | Local computation; 1 day. |
| `curated_upcoming` | curated | Politics, Culture/Religion, Finance | Owner-curated; every entry must cite an official https page and a `verified_on` date. | Local files; 30 days. |

### FRED releases

| Release id | Name | Verified on |
|---:|---|---|
| 101 | FOMC Press Release | 2026-11-03 |
| 50 | Employment Situation | 2026-11-03 |
| 10 | Consumer Price Index | 2026-11-03 |
| 53 | Gross Domestic Product | 2026-11-03 |
| 54 | Personal Income and Outlays | 2026-11-03 |

The ids were checked against the official FRED release index
(`https://fred.stlouisfed.org/releases`) on 2026-11-03.  The `fred/releases`
API check itself needs `FRED_API_KEY`; run
`python -m astro_finance.events.verify_fred_releases` to repeat it.  It could
not be run on the local machine because the key was not set.  In CI the key
comes from the repository secret and the runtime check also verifies each
returned `release_name` against the name in `sources.toml`.

FRED supplies dates, not times, so every FRED event is all-day with
`timezone = "America/New_York"`.  The id for an occurrence is
`theme_slug:fred_release_dates:<release_id>-<YYYY-MM>`, which keeps identity when
a release slips within the same month.  Two releases in one month get `-1`, `-2`
suffixes in date order.

### Natural Disasters

There is no source.  Natural disasters cannot be scheduled.  The bundle records
this in `manifest.theme_metadata` and `quality_report.json`:

```json
{"schedulable": false,
 "reason": "Natural disasters cannot be scheduled; this theme shows history only."}
```

## Identity and lifecycle

`event_id` is deterministic:

- with an external id: `<theme_slug>:<source_id>:<external_id>`;
- without one: `<theme_slug>:<source_id>:<slug(name)>:<start year>`.

The start **year**, not the full date, is intentional: a rescheduled event keeps
its identity within the year.  Curated entries that recur within one year (for
example a central bank's monthly decisions) should declare an `external_id`
that is stable per occurrence, such as `boe-mpc-2026-11`.

Lifecycle rules, applied against `--previous`:

- a new event becomes `scheduled`;
- the same identity with a new date archives the old record as `rescheduled`
  under `<event_id>@<old-date>` and the new canonical record sets
  `supersedes` to that archived id;
- a source that says `cancelled` marks the record `cancelled`;
- a date that has passed becomes `completed`;
- an event missing from a successfully fetched source for one run keeps its
  status and increments `missing_runs`; on the second consecutive miss it
  becomes `unverified`;
- a source that failed or is disabled does not advance `missing_runs`;
- records are never deleted, including archived snapshots;
- historical events are immutable while `historical_events.json` is unchanged.
  If the seed file's SHA-256 changes, the explicit owner edit is adopted: new
  and changed historical events are applied and removals are reflected.

The archive id is deterministic:
`<base>@<old start date>`, with `~2`, `~3` appended only if the same date was
already archived.

## Quality gates

`publishable` is true only when every gate passes.  A failed gate still writes
the bundle and quality reports, and the CLI exits `2`.

| Gate | Pass condition |
|---|---|
| `final_schema` | 0 schema errors in the final event set. |
| `reject_rate` | Rejects are at most 5% of extracted records per source. |
| `historical_immutable` | Historical count and content hashes match `historical_events.json`, unless the seed file changed since the previous bundle. |
| `date_integrity` | No active scheduled/tentative upcoming event is before today; no past event is exposed as scheduled. |
| `duplicate_integrity` | No duplicate `event_id`; no two scheduled events share theme + normalised name + date. |
| `source_freshness` | Every enabled source was fetched this run or succeeded within its `expected_freshness_days`. |
| `distribution_shift` | Each theme's active upcoming count is within ±60% of the previous bundle; when the previous count is under 5 this only warns. |
| `safety` | No secret patterns in output files and every `source_url` is https. |

## Bundle

`<out>/bundle/` contains exactly:

| File | Contents |
|---|---|
| `events.json` | Canonical events, sorted by `(kind, start_date, theme, event_id)`, stable key order. |
| `events.sqlite` | Rebuilt from `events.json`; table `events`; indexes `(kind, theme, status, start_date)` and `event_id`; `PRAGMA user_version = 1`. |
| `manifest.json` | Version, checksums, counts, sources, theme metadata and `publishable`. |
| `quality_report.json` | Machine-readable gate results and per-theme counts. |
| `quality_report.md` | The same report in plain language, suitable for the job summary. |
| `data/macro_regime_history.parquet` | The refreshed macro dataset, when supplied; preferred by the backend over the baked file. |
| `models/model.joblib` | Production forecast model, when a production model exists. |
| `models/model_card.json` | Target, training, walk-forward, calibration and segment metrics for the production model. |
| `models/promotion.json` | Candidate vs production decision and every promotion condition. |
| `models/registry.json` | Model versions, statuses, promotion dates and previous production references. |

`events.sqlite` columns:

`event_id, name, theme, kind, start_date, start_time, timezone, all_day,
status, description, source_id, external_id, source_url,
first_discovered_at, last_updated_at, collected_at, verification, supersedes,
content_hash, days_until, missing_runs`.

`manifest.json` keys:

- `bundle_version` — first 16 hex of SHA-256 over the canonical event content
  (`event.content_dict()` sorted by event id), excluding run timestamps and
  `days_until`, plus the hashes of bundled macro/model files when present;
- `schema_version`, `created_at`, `as_of`, `git_sha`;
- `sources` — id, kind, url, themes, reliability, verification, freshness,
  count, reject count, `last_success_at`, error;
- `counts` — theme × kind × status, zero-filled;
- `theme_metadata` — `schedulable` and the Natural Disasters reason;
- `files` — SHA-256 of every bundle file except `manifest.json` itself;
- `historical_source_sha256`;
- `macro_data` — validation result when a refreshed parquet is included;
- `models` — production version, decision, metrics and registry summary when a model is included;
- `publishable`.

The manifest cannot contain its own hash; every other file is listed.  The
pipeline anchors event and source timestamps to `00:00:00Z` on the build date,
so two builds for the same `--today` are byte-identical apart from
`manifest.created_at` (the only wall-clock value).  A second build that uses the
first as `--previous` has a lower `events_updated` count in its quality report;
its `bundle_version` and canonical event files still match when the facts have
not changed.

## Macro refresh and model lifecycle (Phase D)

The weekly workflow runs the existing macro ingestion before the events build:

```bash
python -m scripts.flows.macro_ingestion --source api \
  --output-dir "$RUNNER_TEMP/macro-refresh"
```

The refreshed parquet is validated against the previous bundle's parquet (or
the baked `data/processed/macro_regime_history.parquet` on the first run):

- schema and column order unchanged;
- row count not decreasing;
- last date advanced, or deliberately unchanged with an explicit reason;
- core-column NaN fractions no more than 10 percentage points above baseline;
- Core Index values within `[-50, 50]`.

A failed check becomes the `macro_data` gate and makes the bundle
unpublishable. The parquet is then stored in the bundle at
`data/macro_regime_history.parquet`; `MacroRegimeService` prefers the active
bundle's copy and falls back to the baked file.

The model target is **S&P 500 proxy lower 28 calendar days later**. Features
are `fed_cross`, `curve_cross` and `sahm_alert`. The 28-day purge gap ensures
training labels do not overlap the test fold. The persistence baseline is the
trailing 28-day S&P direction continuing.

Training and promotion:

```bash
python -m astro_finance.models.regime_forecast train \
  --data macro_regime_history.parquet \
  --out "$RUNNER_TEMP/model" \
  [--previous-bundle PREVIOUS_BUNDLE]
```

Outputs under `<out>/models/`:

- `model.joblib` — production model;
- `model_card.json` — target, training window, data fingerprint, purged
  yearly walk-forward metrics, calibration table, Core Index segment metrics and
  baselines;
- `promotion.json` — decision, reason, candidate/production/persistence
  metrics and every condition;
- `registry.json` — versions with `production`, `candidate`/`retired` status,
  `promoted_at` and `previous_production`.

Training is skipped, with the reason in `promotion.json`, when the dataset
fingerprint and model configuration are unchanged.

A candidate becomes production only if all hold:

1. walk-forward balanced accuracy is at least production + 0.01;
2. Brier score is no worse than production;
3. it beats the persistence baseline;
4. no Core Index bucket is worse than production by more than 0.05.

Otherwise production stays and the candidate is marked retired with the failed
conditions. A first model is promoted if it beats persistence.

The bundle stores `models/model.joblib`, `models/model_card.json`,
`models/promotion.json` and `models/registry.json`. The
`GET /api/v1/regime/forecast` endpoint loads the production model from the
active bundle and never fits in the request path; with no production model it
returns 503.



## Read API

The backend exposes two read-only routes under `/api/v1/events`. They never
call the network.

| Method | Path | Returns |
|---|---|---|
| GET | `/api/v1/events/upcoming` | `{as_of, bundle_version, message, themes: {<theme>: {schedulable, total_available, events: [...]}}}` |
| GET | `/api/v1/events/health` | `{active_version, created_at, counts, schema_version}` |

`upcoming` query parameters:

- `themes` — comma-separated theme names; omit for all five. Unknown names are
  a 422.
- `limit_per_theme` — 1–20, default 5.
- `horizon_days` — 1–730, default 365.

Only `scheduled` and `tentative` events at or after today are returned, ordered
by start date then start time. Natural Disasters always returns
`schedulable: false`, `total_available: 0` and no events. The response is
`Cache-Control: public, s-maxage=3600, stale-while-revalidate=86400`.

The active bundle is resolved through the activation pointer:
`$EVENTS_RUNTIME_DIR/current` (default `backend/data/runtime/events`). The
pointer holds a bundle directory (absolute, relative to the runtime directory,
or a bare version under `bundles/`). `store.current_bundle_dir` caches the
resolved path by the pointer file's mtime. With no pointer, `upcoming` returns
the five themes with empty lists and an honest message, and `health` returns
`active_version: null` and zero counts.

The Next.js proxy routes are
`frontend/src/app/api/v1/events/upcoming/route.ts` and
`.../events/health/route.ts`. The UI is the **Upcoming** view beside the
existing **Sky ladder** in `FutureLadder.jsx`; it uses a shareable `?themes=`
filter and never changes the astro-similarity ladder itself.

## Adding a curated event

Open the official page first.  Then add a block to the matching
`backend/data/events/curated/*.toml`:

```toml
[[events]]
theme = "Finance"                                  # Politics | Culture/Religion | Finance
name = "RBI Monetary Policy Committee decision"    # required
date = "2026-12-04"                                # required, YYYY-MM-DD
external_id = "rbi-mpc-2026-12"                    # optional, stable per occurrence
source_url = "https://www.rbi.org.in/..."          # required, official https page
verified_on = "2026-11-03"                         # required, the day you checked
status = "scheduled"                               # scheduled | tentative | cancelled
description = "Optional plain-language note."
# time = "10:00"                                   # optional; requires timezone
# timezone = "Asia/Kolkata"                        # IANA zone
```

An entry without `source_url`, with a non-https URL, with a future
`verified_on`, or with a theme outside the three curated themes is rejected and
reported in `rejects.json`.  A recurring title needs an `external_id`; otherwise
two occurrences in one year collide under the name+year fallback.

Do not pad a theme.  The UI shows up to five verified events per theme; fewer
than five is expected and acceptable.  `politics.toml` and
`culture_religion.toml` currently contain only commented examples because no
2026-2027 date was verified on an official page on 2026-11-03.

## Running locally

From `backend/`, with the local Python that has the backend dependencies:

```bash
# Windows
PYTHONPATH="src;." C:/Python314/python.exe -m astro_finance.events build \
  --out C:/temp/events-demo --offline tests/events/fixtures/offline \
  --today 2026-11-03

# Linux / CI
PYTHONPATH="src:." python -m astro_finance.events build \
  --out /tmp/events-demo --offline tests/events/fixtures/offline \
  --today 2026-11-03
```

Other commands:

```bash
python -m astro_finance.events validate <bundle-dir>
python -m astro_finance.events report <bundle-dir>
python -m astro_finance.events diff <old-bundle> <new-bundle>
```

Exit codes: `0` okay, `2` one or more gates failed or the build used `--offline`
(the bundle is still written with `publishable: false`), `1` an error or a
failed stage.  Any `--offline` build is a test build: `manifest.publishable` is
always false and `quality_report.md` starts with
`TEST BUILD (offline fixtures), never publishable`.

`--offline` replaces network sources with fixtures under
`tests/events/fixtures/offline/`; the checked-in FRED fixtures are synthetic
test data, clearly marked inside each file.  Without `--offline`, FRED is
fetched only when `FRED_API_KEY` is set in the environment; the key is never
read from `.env` here and is redacted from every log line and error.

Tests:

```bash
PYTHONPATH="src;." C:/Python314/python.exe -m pytest tests/events -q
```

## Activation and rollback

The weekly workflow publishes a release and then activates it automatically
when the bundle is publishable and the run is not a `dry_run`.

Release assets:

```text
events-bundle-<V>.tar.gz   # bundle files at the tarball root, including manifest.json
manifest.json             # standalone, byte-identical to the tarball copy
SHA256SUMS                # hashes for the tarball and standalone manifest
```

Inside the running backend container:

```bash
python -m astro_finance.events activate --version <V> \
  [--repo kpdagrt22/strikehike-monorepo]
```

Activation:

1. downloads the three assets over HTTPS from the public GitHub Release (no
   token);
2. verifies `SHA256SUMS`, the standalone manifest, `bundle_version`,
   `publishable: true`, and every file hash in `manifest.json`;
3. extracts to `bundles/<V>.tmp` with a path-traversal-safe extractor, then
   renames it to `bundles/<V>`;
4. runs `PRAGMA integrity_check`, checks `user_version`, and compares the SQLite
   row count with the manifest's theme × kind × status counts;
5. writes `current.tmp` containing the runtime-relative
   `bundles/<V>`, fsyncs it and `os.replace`s it onto `current`;
6. self-checks through `store.py` (version and full counts);
7. on any failure restores the previous `current` pointer, removes the
   partially installed version and exits non-zero;
8. on success records the old pointer in `<runtime>/previous`, keeps the three
   newest bundle directories, and prunes older ones.

`<runtime>` defaults to `backend/data/runtime/events`, overridable with
`EVENTS_RUNTIME_DIR`; in the container it is `/app/data/runtime/events`.

Other commands:

```bash
python -m astro_finance.events rollback [--runtime-dir DIR]
python -m astro_finance.events status [--runtime-dir DIR] [--json]
```

`rollback` verifies the previous bundle before swapping `current`, then swaps
the `previous` pointer too, so a second rollback returns to the newer version.
`status` lists the active and previous versions and every retained directory.

The workflow's `activate` job uses the existing Lightsail deploy secrets and
the same SSH action as `deploy-lightsail.yml`, joins the
`lightsail-production` concurrency group, runs the activation inside the
backend container, then requires the public health endpoint to report the new
version and `counts.total > 0`. Activation failures restore the previous
pointer inside the CLI; a post-activation health failure runs the rollback
command and fails the job.

## Release ownership and manual recovery

The build workflow stops after the artifact and the jobs above publish and
activate automatically.  Before the build it runs `verify_fred_releases` with
`FRED_API_KEY`; a missing key or a changed release id/name fails the job.

If the SSH activation cannot reach the container, run the same command by hand
from the application directory:

```bash
docker compose -p strikehike-chrono exec -T backend \
  python -m astro_finance.events activate --version <V>
docker compose -p strikehike-chrono exec -T backend \
  python -m astro_finance.events rollback
```

The read API resolves `current` on each request, caches by the pointer file's
mtime, and falls back to the empty five-theme response when no pointer exists.
Never call the network from the request path.

## Assumptions and open questions

- "Upcoming" means real scheduled events; no astrological similarity events are
  mixed in.  The existing forecast-ladder view is untouched.
- FRED release ids were verified against FRED's public release index because
  `FRED_API_KEY` was not available locally; the API name check is enforced in
  CI.
- Curated Politics and non-Easter Culture/Religion entries are empty rather
  than padded.
- The bundle's `days_until` is recomputed at read time by `store.py`, so a
  cached bundle stays correct as the date advances.
