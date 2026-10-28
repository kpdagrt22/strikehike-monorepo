# StrikeHike backend

The FastAPI service behind [strikehike.com](https://strikehike.com), the macro regime package it serves, the ingestion flow that builds its data artifact, and the data files themselves. For the whole system (frontend, deployment, data sources), see the [root README](../README.md).

## What runs

The production entry point is `uvicorn api_server:app` on port 8010 (see `Dockerfile`; Docker Compose publishes it on `127.0.0.1:8010`). At startup the app:

- loads `data/processed/final_data_with_regimes.csv` and fits the energy metric compiler on it;
- seeds the SQLite event store from `data/historical_events.json` if the store is missing or empty;
- leaves the earlier HMM and XGBoost model files unloaded unless `LOAD_ML_MODELS=1`.

The regime routes load `data/processed/macro_regime_history.parquet` on first use and reload it whenever the file changes. Nothing in the request path calls an external service.

| Path | Role |
|---|---|
| `api_server.py` | The FastAPI app. Mounts the regime and patterns routers under `/api/v1` and serves planetary positions, historical parallels, the forecast ladder, the event list and `/health`. |
| `regime/router.py` | Routes under `/api/v1/regime` and `/api/v1/patterns`. |
| `regime/service.py` | `MacroRegimeService`: loads the parquet artifact and its metadata, caches payloads, and builds the timeline, regime runs, crypto milestones, pattern comparison and 30-day regime probability. |
| `regime/analytics.py` | Macro strength meter, Core Index, NBER episodes and crash windows, and the long-run S&P 500 series. Shared with the ingestion flow. |
| `regime/patterns.py`, `regime/patterns_events.json` | The 120-year pattern comparison and its curated events. |
| `regime/patterns_v2.py` | Study of Patterns v2: the past 12-month setups closest to the latest 12 months, what followed them beside the usual rate, and the 120-year mirror. Served as the `engine` block of `/api/v1/patterns`. |
| `regime/crypto_milestones.py` | Hand-picked crypto comparison windows (editorial, not statistically detected). |
| `regime/schemas.py` | Pydantic response models. |
| `src/astro_finance/energy_metric_compiler.py` | Turns a row of the precomputed daily frame into a 0–100 energy score and a polarity state. |
| `src/astro_finance/historical_parallels.py` | The SQLite event store, Swiss Ephemeris (Lahiri) geometry for each event, the similarity search and the forecast ladder. |
| `scripts/flows/macro_ingestion.py` | Offline ingestion that builds the macro artifact (see below). |
| `scripts/recompute_core_index.py` | Recomputes only the Core Index v2 columns of the committed parquet from its stored inputs and updates the metadata; `--check` is read-only and exits 1 when they are stale. |
| `scripts/patterns_v2_evidence.py` | The offline walk-forward track record for Study of Patterns v2; writes `data/processed/patterns_v2_skill.json`. |
| `scripts/force_reseed_db.py`, `scripts/seed_historical_events.py` | Drop and rebuild the SQLite event store from the JSON seed. |
| `Dockerfile` | Production image: Python 3.11.9-slim with `requirements-minimal.txt`, `api_server.py`, `src/`, `regime/`, `scripts/`, `websocket_server.py` and the six data files the API reads. |
| `requirements-minimal.txt` | Dependencies installed by the image and by CI. |
| `tests/` | The pytest suite. |

### In progress on this branch

Not yet on strikehike.com: the ingestion flow's daily S&P 500 history from Yahoo Finance (`^GSPC`), Core Index v2 with its severity, warning and trend-warning columns, Study of Patterns v2 (`regime/patterns_v2.py` and `data/processed/patterns_v2_skill.json`), and a Convergence case catalogue (`regime/cases.py`, `regime/cases_router.py`, `regime/case_schemas.py`, mounted under `/api/v1/regime`, with tests in `tests/test_regime_cases.py`).

## Run

From this directory (the app opens `data/processed/final_data_with_regimes.csv` by a path relative to the working directory):

```bash
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements-minimal.txt
uvicorn api_server:app --port 8000
```

The frontend's route handlers expect the backend at `http://127.0.0.1:8000` unless `CHRONO_API_URL` says otherwise. FastAPI serves interactive docs at `/docs` and `/redoc`. In production the port is reachable only from the host and the Compose network; the browser reaches the endpoints the site uses through the frontend's route handlers.

## API

| Method | Path | Returns |
|---|---|---|
| GET | `/health` | `{"status": "healthy", ...}`; used by the Docker health check and the deploy workflow |
| GET | `/api/v1/regime/macro-history` | The downsampled macro timeline (macro strength, regime state, Core Index, asset series, drawdowns, volatility percentiles) and every NBER recession window. Query: `resolution` (`auto`, `daily`, `weekly`, `monthly`), optional `start` and `end` |
| GET | `/api/v1/regime/runs` | Monthly regime runs, the 3×3 transition matrix and median durations |
| GET | `/api/v1/regime/crypto-milestones` | The curated crypto windows with asset drawdowns and Core Index readings |
| GET | `/api/v1/regime/forecast` | The probability that the regime is "disruptive" 30 calendar days ahead, from a logistic regression on three artifact features (`fed_cross`, `curve_cross`, `sahm_alert`), fitted on first request and cached until the artifact changes |
| GET | `/api/v1/patterns` | The 120-year pattern comparison and the historical year that followed, plus the Study of Patterns v2 `engine` block (closest historical setups, the usual rate, the 120-year mirror and the precomputed track record; `null` if it cannot be built). Query: `asset` (`sp500`, `nifty`, `gold`, `bonds`, `bitcoin`) |
| GET | `/api/v1/astro-positions` | Planetary positions and the 0–100 energy metric for a `date` inside the precomputed frame (1992-02-11 to 2025-01-01) |
| GET, POST | `/api/v1/historical-parallels` | Historical and recent events whose planetary geometry is closest to a date (and optional UTC minute) |
| GET | `/api/v1/forecast-ladder` | The strongest upcoming geometric echoes of past events within the next `days` (1–180) |
| GET | `/api/v1/events` | The curated event list, grouped into five categories |
| GET | `/`, `/api/current-state`, `/api/historical` | Endpoints kept from the earlier API; the frontend does not call them |

## Data files

The image copies exactly these files; everything else under `data/` stays out of it.

| File | Produced by | Read by |
|---|---|---|
| `data/processed/macro_regime_history.parquet` | `scripts/flows/macro_ingestion.py` | `regime/service.py` |
| `data/processed/macro_regime_history.meta.json` | The same flow: coverage, versions, notes and warnings, each FRED series with its URL, and a source label for each asset series | `regime/service.py`, which returns parts of it as `meta` |
| `data/processed/crypto_milestones.json` | The same flow, from `regime/crypto_milestones.py` | `regime/service.py` |
| `data/processed/patterns_v2_skill.json` | The same flow, or `scripts/patterns_v2_evidence.py`: the Study of Patterns v2 track record per asset, stamped with the parquet's `data_version` | `regime/service.py` (the `engine.skill` block) |
| `data/processed/final_data_with_regimes.csv` | Committed with the earlier project's code: a daily frame of planetary features, regime labels and volatility from 1992-02-11 to 2025-01-01. No script in this repository writes it | `api_server.py` and the energy metric compiler |
| `data/historical_events.json` | Curated by hand | `historical_parallels.py`, which seeds SQLite at `HISTORICAL_EVENTS_DB` |

## Ingestion flow

`scripts/flows/macro_ingestion.py` runs offline, never in the request path. It:

1. fetches every series in its FRED registry (`SERIES_REGISTRY`), using the official API when `FRED_API_KEY` is set and FRED's public CSV endpoint otherwise (`--source auto|api|csv`). Requests retry with backoff, and each series is cached as CSV in `data/raw/fred/` (git-ignored);
2. fetches the series that do not come from FRED: the World Bank Pink Sheet London gold price (monthly), Blockchain.com's daily Bitcoin price, and Yahoo Finance daily closes for the Nifty 50 (`^NSEI`) and, on this branch, the S&P 500 (`^GSPC`). Without an API key it also backfills the ICE BofA high-yield spread from a public mirror, because FRED's CSV endpoint serves only the last three years of that series;
3. merges everything onto one forward-filled daily calendar, marks NBER recession windows from `USREC`, and computes the macro strength meter (a 0–100 coincident heuristic from the Fed funds rate, the 10-year minus 2-year Treasury spread and a Sahm-rule unemployment proxy), the Core Index, the asset series, one-year drawdowns and volatility percentiles. The Core Index (`core-index-v2` in `regime/analytics.py`) is a weekly trend-and-stress state machine decided at each Friday close on the daily S&P 500 series, with credit spreads, unemployment and the yield curve as stress inputs, each lagged by its publication delay. It also writes a severity label, a warning flag and a separate 40-week trend warning, and keeps the retired v1 composite's inputs and sub-scores as diagnostic columns;
4. writes the parquet file, its `.meta.json`, `crypto_milestones.json` and `patterns_v2_skill.json` to `--output-dir` (default `data/processed/`), each through a temporary file that then replaces the old one.

```bash
python -m scripts.flows.macro_ingestion --check-key   # validate FRED_API_KEY, if you have one
python -m scripts.flows.macro_ingestion               # fetch (reusing fresh caches, see below) and build
python -m scripts.flows.macro_ingestion --refresh     # ignore the caches
python -m scripts.flows.macro_ingestion --offline     # build from the caches only, with no network requests
```

Other options: `--series`, `--start`, `--end`, `--output-dir`, `--cache-dir`, `--max-age-hours` (default 24: how old a cached FRED series may be before it is fetched again), `--delay` (default 0.6 seconds between FRED requests) and `--verbose`. The other caches have fixed lifetimes (24 hours for Bitcoin and the Yahoo Finance series, 7 days for gold); the high-yield spread archive is reused until `--refresh`.

The manual GitHub workflow `macro-ingestion.yml` runs the flow with `--source api` and the repository's `FRED_API_KEY` secret, then uploads the four files as a workflow artifact named `macro-regime-history`. It does not commit them. The site picks up new data only after the files are committed and deployed, because the image copies them at build time.

## Configuration

| Variable | Default | Effect |
|---|---|---|
| `CORS_ORIGINS` | `http://localhost:3000,http://localhost:3001` | Comma-separated browser origins allowed by CORS |
| `LOAD_ML_MODELS` | `0` | `1` loads `hmm_model.joblib` and `xgboost_model.joblib` at startup. No endpoint uses them, and the image does not contain them |
| `ENABLE_LEGACY_WEBSOCKET` | `0` | `1` mounts the simulated Socket.IO feed from `websocket_server.py` |
| `HISTORICAL_EVENTS_DB` | `data/historical_events.db` | Path of the SQLite event store |
| `HISTORICAL_EVENTS_SEED` | `data/historical_events.json` | Seed file for the event store |
| `FRED_API_KEY` | unset | Ingestion only. Read from the environment, `backend/.env` or the repository-root `.env` |

Docker Compose sets `LOAD_ML_MODELS=0` and `ENABLE_LEGACY_WEBSOCKET=0`, keeps the event store on the `historical-data` volume (`/app/data/runtime/historical_events.db`), and takes `CORS_ORIGINS` from the repository-root `.env` on the host. `.env.example` in this folder lists the same variables.

## Tests

The "Backend tests" job in `.github/workflows/deploy-lightsail.yml` runs on every push to `main` and must pass before the deploy job starts. It installs `requirements-minimal.txt` on Python 3.11.9 and runs, from this directory with `PYTHONPATH=src:.`:

```bash
python -m pytest \
  tests/test_energy_metric_compiler.py \
  tests/test_historical_parallels.py \
  tests/test_macro_ingestion.py \
  tests/test_patterns.py \
  tests/test_regime_service.py \
  tests/test_regime_cases.py \
  -q
```

On Windows, set `PYTHONPATH` to `src;.` instead.

| Module | Covers |
|---|---|
| `test_energy_metric_compiler.py` | Polarity states, intensity weights and the bounded energy score |
| `test_historical_parallels.py` | Event geometry, seeding and categories, the dual-epoch split and the forecast ladder |
| `test_macro_ingestion.py` | The series registry, FRED and Yahoo parsing, the daily merge, NBER alignment, the macro strength meter, the S&P 500 series, the asset series and the Core Index |
| `test_patterns.py` | The 120-year date, the one-year forward window and the fallback for assets with short histories; Study of Patterns v2 causality (no look-ahead), its API contract and the committed skill artifact |
| `test_regime_service.py` | Macro history, regime runs, the 30-day probability, input validation and crypto milestones |
| `test_regime_cases.py` | The Convergence case catalogue (in progress): episode detection, case and path contracts, caching and routes |

## Legacy code not used by the site

This backend grew out of an earlier project, Astro Finance. Older experiments from that project were removed on 28 October 2026: its ML training and validation scripts, two microservices, Pine Script indicators, Prefect, Kubernetes and Prometheus configuration, and planning notes. Git history keeps them. The files below remain; strikehike.com does not run them, and the figures they contain are not claims about the current product.

| Path | What it is | Status |
|---|---|---|
| `src/astro_finance/`, apart from `energy_metric_compiler.py` and `historical_parallels.py` | The earlier pipeline: data ingestion, features, Gann tools, models, validation and an older API | Copied into the image with `src/` but not imported by `api_server:app` (running `python api_server.py` directly also mounts `api/gann_routes.py`) |
| `websocket_server.py` | A simulated Socket.IO feed | Off unless `ENABLE_LEGACY_WEBSOCKET=1` |
| `data/processed/*.joblib`, `data/processed/*.pth`, `final_data_with_gann.csv`, `merged_data.csv`, `retraining_summary.json`, `data/validation_results_*.csv`, `data/raw/` | Model files, inputs and outputs from the earlier project | Not in the image |
| `config/`, `requirements.txt` | The earlier pipeline's settings and its full dependency list | Not used by CI or the deploy |

`pyproject.toml` also dates from the earlier project; pytest still reads its `[tool.pytest.ini_options]` section.
