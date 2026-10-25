# Production Runbook - Astro Finance

## Overview
This runbook contains operational procedures for the Astro Finance production pipeline.

---

## Daily Operations

### Scheduled Flow Executions (UTC)
- **00:05** → `daily-data-ingest` (Incremental market data)
- **00:30** → `daily-inference` (ML predictions)
- **01:00** → `tradingview-export` (PineScript generation)

### Health Checks
**Daily (Morning):**
1. Visit Prefect Dashboard: https://app.prefect.cloud
2. Verify last 3 flow runs succeeded (green checkmarks)
3. Check agent status: "Online"

**Weekly (Monday):**
1. Review 7-day success rate (target: >95%)
2. Check data continuity (no missing trading days)
3. Download TradingView script → Verify signals render

---

## Monitoring & Alerts

### Prefect Cloud Dashboard
- **Flow Runs:** View execution history, logs, task durations
- **Deployments:** Check schedules, pause/resume flows
- **Agents:** Monitor connection status

### Email Alerts (Configured in Prefect UI)
- Flow failures
- Task retries exceeded (>3 attempts)
- Long-running tasks (>10 minutes)

**Alert Response:**
1. Check flow logs in Prefect UI
2. Identify failing task
3. See "Troubleshooting" section below

---

## Manual Operations

### Trigger Flow Manually
```bash
# From Prefect UI
# Deployments → Select flow → "Run" → "Quick Run"

# From CLI
prefect deployment run daily-data-ingest/default
prefect deployment run daily-inference/default
prefect deployment run tradingview-export/default
```

### Pause Scheduled Runs
```bash
prefect deployment pause daily-data-ingest
prefect deployment pause daily-inference
prefect deployment pause tradingview-export
```

### Resume Scheduled Runs
```bash
prefect deployment resume daily-data-ingest
prefect deployment resume daily-inference
prefect deployment resume tradingview-export
```

---

## Troubleshooting

### Issue: "No new data available" (Data Ingestion)
**Symptoms:** Flow completes with `rows_added: 0`

**Diagnosis:**
- Market closed (weekend/holiday)
- Yahoo Finance API issue
- Data already up-to-date

**Resolution:**
- If weekend: Expected behavior, no action needed
- If weekday: Check Yahoo Finance status, retry manually

---

### Issue: Flow Fails with "ModuleNotFoundError"
**Symptoms:** Task fails, log shows import error

**Diagnosis:**
- Missing dependency on agent machine
- Incorrect PYTHONPATH

**Resolution:**
```bash
# On agent machine
cd d:\astro_finance_clean
pip install -r requirements.txt

# Restart agent
prefect agent start default
```

---

### Issue: Agent Shows "Offline"
**Symptoms:** Flows scheduled but not executing

**Diagnosis:**
- Agent process stopped
- Network connection issue

**Resolution:**
```bash
# Check if agent is running
# Windows: Task Manager → Look for python.exe running prefect

# Restart agent
cd d:\astro_finance_clean
prefect agent start default
```

**Permanent Solution:** Setup agent as Windows Service
```bash
# Install NSSM (Non-Sucking Service Manager)
# Download from: https://nssm.cc/download

# Create service
nssm install PrefectAgent "C:\Python314\python.exe" "-m prefect agent start default"
nssm set PrefectAgent AppDirectory "d:\astro_finance_clean"
nssm start PrefectAgent
```

---

### Issue: Predictions Look Incorrect
**Symptoms:** Dashboard shows unrealistic values

**Diagnosis:**
- Data quality issue (NaN values)
- Model weights not loaded
- Feature calculation error

**Resolution:**
1. Check `data/processed/merged_data.csv` for NaN
2. Review model inference logs
3. Run validation manually:
   ```bash
   python -m scripts.validate_simple
   ```

---

### Issue: TradingView Script Empty
**Symptoms:** `astro_signal.pine` has no signals

**Diagnosis:**
- No high-confidence predictions (all <0.8)
- Track record JSON missing

**Resolution:**
1. Check `web/public/track_record.json` exists
2. Verify confidence scores in predictions
3. Lower threshold temporarily:
   ```bash
   # Edit deployments/daily_pipeline.py
   # Change: confidence_threshold: 0.8 → 0.6
   # Redeploy flows
   ```

---

## Disaster Recovery

### Data Loss / Corruption
**Backup Strategy:** Git tracks code, not data

**Recovery:**
1. Stop all flows: `prefect deployment pause --all`
2. Restore data from backup (manual process)
3. Verify data integrity:
   ```bash
   python scripts/test_flows.py
   ```
4. Resume flows: `prefect deployment resume --all`

---

### Complete System Rebuild
1. Clone repo: `git clone https://github.com/kpdagrt22/astro_fiannce_clean.git`
2. Install dependencies: `pip install -r requirements.txt`
3. Setup Prefect: `prefect cloud login`
4. Deploy flows: `python deployments/daily_pipeline.py`
5. Start agent: `prefect agent start default`

---

## Performance Optimization

### Current Benchmarks
- **Data Ingestion:** ~10 seconds (incremental)
- **Model Inference:** ~30 seconds
- **TradingView Export:** ~5 seconds

### If Flows Slow Down
1. Check network latency (Yahoo Finance API)
2. Review data size growth (CSV →  Parquet migration)
3. Enable caching for planetary feature calculations

---

## Contacts & Escalation

**Primary:** Monitor Prefect dashboard daily  
**Escalation:** Review logs → Consult `docs/ops_research.md`  
**Emergency:** Pause flows, switch to manual validation

---

## Change Log

| Date | Change | By |
|------|--------|-----|
| 2026-01-12 | Initial runbook creation | Antigravity |

---

*Last Updated: 2026-01-12*
