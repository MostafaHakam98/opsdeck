# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS frontend
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim-bookworm AS dependencies
WORKDIR /build
COPY backend/requirements.lock ./requirements.lock
RUN --mount=type=cache,target=/root/.cache/pip pip install --prefix=/install -r requirements.lock

FROM python:3.12-slim-bookworm AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends util-linux systemd ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 12001 opsdeck && useradd --uid 12001 --gid opsdeck --no-create-home opsdeck \
    && mkdir -p /app /data && chown opsdeck:opsdeck /data && chmod 700 /data
COPY --from=dependencies /install /usr/local
WORKDIR /app
COPY --chown=opsdeck:opsdeck backend/ backend/
COPY --chown=opsdeck:opsdeck deploy/ deploy/
COPY --chown=opsdeck:opsdeck scripts/ scripts/
COPY --from=frontend /build/frontend/dist/ frontend/dist/
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 OPSDECK_BIND=0.0.0.0 OPSDECK_PORT=8080 \
    OPSDECK_DB=/data/opsdeck.sqlite OPSDECK_SCOPE=container OPSDECK_ENV_FILE=/data/config.env
USER 12001:12001
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=15s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/healthz', timeout=2)" || exit 1
CMD ["python", "-m", "backend.run"]
