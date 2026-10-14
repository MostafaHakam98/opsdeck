#!/usr/bin/env bash
# Build locally; deploy without npm, pip, or network access on the host.
set -euo pipefail
cd "$(dirname "$0")/.."
npm ci --prefix frontend --cache /tmp/opsdeck-npm-cache --no-audit --no-fund
npm run build --prefix frontend
mkdir -p dist/bundle/wheels
.venv/bin/python -m pip download --only-binary=:all: --python-version 3.12 --implementation cp --abi cp312 --platform manylinux2014_x86_64 --platform manylinux_2_28_x86_64 -d dist/bundle/wheels -r backend/requirements.lock pip
cp -a backend deploy dist/bundle/
# Keep frontend artifacts in the path expected by the backend.
mkdir -p dist/bundle/frontend
cp -a frontend/dist dist/bundle/frontend/
cp .env.example README.md tune-runner-host.sh dist/bundle/
tar --exclude=__pycache__ -czf dist/opsdeck-linux-x86_64-py312.tar.gz -C dist/bundle backend frontend deploy wheels .env.example README.md tune-runner-host.sh
sha256sum dist/opsdeck-linux-x86_64-py312.tar.gz
