#!/usr/bin/env bash
# Build locally; deploy without npm, pip, or network access on the host.
set -euo pipefail
cd "$(dirname "$0")/../.."
npm ci --prefix frontend --cache /tmp/opsdeck-npm-cache --no-audit --no-fund
npm run build --prefix frontend
mkdir -p dist
BUNDLE_DIR=$(mktemp -d "$PWD/dist/opsdeck-bundle.XXXXXX")
trap 'rm -rf -- "$BUNDLE_DIR"' EXIT
mkdir -p "$BUNDLE_DIR/wheels"
.venv/bin/python -m pip download --only-binary=:all: --python-version 3.12 --implementation cp --abi cp312 --platform manylinux2014_x86_64 --platform manylinux_2_28_x86_64 -d "$BUNDLE_DIR/wheels" -r backend/requirements.lock pip
cp -a backend deploy scripts "$BUNDLE_DIR/"
# Keep frontend artifacts in the path expected by the backend.
mkdir -p "$BUNDLE_DIR/frontend"
cp -a frontend/dist "$BUNDLE_DIR/frontend/"
cp -a docs "$BUNDLE_DIR/"
cp .env.example .env.agent.example README.md Makefile .dockerignore "$BUNDLE_DIR/"
tar --exclude=__pycache__ -czf dist/opsdeck-linux-x86_64-py312.tar.gz -C "$BUNDLE_DIR" backend frontend deploy scripts docs wheels .env.example .env.agent.example README.md Makefile .dockerignore
sha256sum dist/opsdeck-linux-x86_64-py312.tar.gz
