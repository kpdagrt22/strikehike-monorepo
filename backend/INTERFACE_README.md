# Market & Cosmos Intelligence Interface

A minimalist, high-performance visualization system coupling real-time financial intelligence with planetary motion.

## Quick Start

**Double-click `start_app.bat`** to launch the entire system.

## Manual Startup

1. **Backend (API)**
   ```powershell
   python src/astro_finance/api/main.py
   ```

2. **Frontend (Interface)**
   ```powershell
   cd web
   npm start
   ```
   *(Note: Run `npm run build` first if this is a fresh install)*

## Architecture

- **Backend**: FastAPI (`src/astro_finance/api`)
- **Frontend**: Next.js 14 (`web/`)
- **Engine**: Real-time HMM + XGBoost Inference (`src/astro_finance/api/engine.py`)
