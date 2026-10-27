FROM python:3.11.9-slim AS builder
ENV PIP_NO_CACHE_DIR=1
WORKDIR /build

RUN apt-get update && apt-get install -y --no-install-recommends build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY requirements-minimal.txt .
RUN python -m pip install --upgrade pip \
    && python -m pip install --prefix=/install -r requirements-minimal.txt

FROM python:3.11.9-slim AS runner
ENV PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app/src \
    LOAD_ML_MODELS=0 \
    ENABLE_LEGACY_WEBSOCKET=0

WORKDIR /app

COPY --from=builder /install /usr/local
COPY api_server.py ./
COPY src ./src
COPY regime ./regime
COPY scripts ./scripts
COPY websocket_server.py ./
COPY data/historical_events.json ./data/historical_events.json
COPY data/processed/final_data_with_regimes.csv ./data/processed/final_data_with_regimes.csv
COPY data/processed/macro_regime_history.parquet ./data/processed/macro_regime_history.parquet
COPY data/processed/macro_regime_history.meta.json ./data/processed/macro_regime_history.meta.json
COPY data/processed/crypto_milestones.json ./data/processed/crypto_milestones.json

RUN mkdir -p /app/data/runtime

EXPOSE 8010

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=5 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8010/health')"

CMD ["uvicorn", "api_server:app", "--host", "0.0.0.0", "--port", "8010"]
