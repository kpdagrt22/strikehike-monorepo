# Stage 1: Builder
FROM python:3.11-slim as builder

WORKDIR /build

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc g++ libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements-minimal.txt .
COPY services/gann/requirements.txt ./service-requirements.txt
RUN pip install --no-cache-dir --user -r requirements-minimal.txt && \
    pip install --no-cache-dir --user -r service-requirements.txt

# Stage 2: Runtime
FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /root/.local /root/.local
COPY src/ ./src/
COPY services/gann/ ./services/gann/

ENV PYTHONPATH=/app \
    PATH=/root/.local/bin:$PATH \
    PYTHONUNBUFFERED=1

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD python -c "import requests; requests.get('http://localhost:8000/health')"

CMD ["gunicorn", "services.gann.main:app", \
    "--workers", "4", \
    "--worker-class", "uvicorn.workers.UvicornWorker", \
    "--bind", "0.0.0.0:8000", \
    "--timeout", "120"]
