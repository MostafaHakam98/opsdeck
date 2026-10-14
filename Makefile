SHELL := /bin/bash
.DEFAULT_GOAL := help
PYTHON ?= python3
VENV := .venv/bin/python
NPM_CACHE ?= /tmp/opsdeck-npm-cache
COMPOSE := docker compose -f compose.yaml
HOST_COMPOSE := $(COMPOSE) -f compose.host.yaml
GPU_COMPOSE := $(HOST_COMPOSE) -f compose.gpu.yaml
DOCKER_SOCKET ?= /var/run/docker.sock
DOCKER_SOCKET_GID = $(shell stat -c '%g' '$(DOCKER_SOCKET)' 2>/dev/null)
IMAGE ?= opsdeck:local
BACKUP_DB ?= data/opsdeck.sqlite

.PHONY: help init setup build run dev dev-api dev-ui test test-backend test-frontend test-e2e check format health backup bundle service-install service-status service-logs docker-build docker-test docker-up docker-gpu-up docker-sandbox-up docker-config docker-status docker-logs docker-down docker-restart docker-backup

help: ## Show available commands
	@awk 'BEGIN {FS = ":.*## "; printf "OpsDeck commands\n\n"} /^[a-zA-Z0-9_-]+:.*## / {printf "  %-23s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

init: ## Create .tmp/ and a private .env with a random token; preserve existing config
	@$(PYTHON) -m deploy.configure

setup: init ## Install pinned backend and frontend dependencies
	$(PYTHON) -m venv .venv
	$(VENV) -m pip install -r backend/requirements.lock
	npm ci --prefix frontend --cache $(NPM_CACHE) --no-audit --no-fund

build: ## Build the production frontend
	npm run build --prefix frontend

run: init build ## Run the production API and dashboard (foreground)
	$(VENV) -m backend.run

dev: ## Show the two development commands
	@echo 'Terminal 1: make dev-api'
	@echo 'Terminal 2: make dev-ui'

dev-api: init ## Run the API with source reload on localhost:8080
	OPSDECK_BIND=127.0.0.1 OPSDECK_PORT=8080 $(VENV) -m backend.run --reload

dev-ui: ## Run Vite with API proxy on localhost:5173
	npm run dev --prefix frontend

test: test-backend test-frontend ## Run backend and frontend unit/integration tests

test-backend: ## Run backend, collector, action, and deployment-helper tests
	$(VENV) -m pytest -q

test-frontend: ## Run frontend metric-formatting tests
	npm test --prefix frontend

test-e2e: build ## Run Chromium browser checks (install it first with Playwright)
	npm run test:e2e --prefix frontend

check: test build ## Run tests, production build, shell syntax, and Python compilation
	bash -n tune-runner-host.sh deploy/*.sh
	$(PYTHON) -m compileall -q backend deploy

format: ## Format frontend source and configuration
	npm exec --prefix frontend -- prettier --write frontend/src frontend/e2e frontend/*.ts frontend/*.json frontend/index.html

health: ## Check the local app liveness endpoint
	@curl --fail --silent --show-error http://127.0.0.1:$${OPSDECK_PORT:-8080}/healthz
	@echo

backup: ## Make a consistent SQLite backup under ignored .tmp/backups/
	$(PYTHON) -m deploy.backup --source '$(BACKUP_DB)'

bundle: ## Build the offline Linux x86_64 / Python 3.12 deployment archive
	bash deploy/build-bundle.sh

service-install: ## Install the built native app as a user systemd service
	bash deploy/install-user.sh

service-status: ## Show native service state
	systemctl --user status opsdeck --no-pager

service-logs: ## Follow native application logs
	journalctl --user -u opsdeck -f

docker-build: ## Build the multi-stage application image
	docker build -t $(IMAGE) .

docker-test: ## Verify Compose auth, persistent history, and Linux host collection in a disposable project
	$(PYTHON) -m deploy.container_smoke

docker-config: init ## Validate portable, Linux host, and GPU Compose configurations (no secrets printed)
	$(COMPOSE) config --quiet
	OPSDECK_DOCKER_GID=$${OPSDECK_DOCKER_GID:-$(DOCKER_SOCKET_GID)} $(HOST_COMPOSE) config --quiet
	OPSDECK_DOCKER_GID=$${OPSDECK_DOCKER_GID:-$(DOCKER_SOCKET_GID)} $(GPU_COMPOSE) config --quiet

docker-up: init ## Build and start Linux host monitoring with persistent history
	@test -S '$(DOCKER_SOCKET)' || { echo 'Docker socket missing; set DOCKER_SOCKET or use docker-sandbox-up.' >&2; exit 1; }
	OPSDECK_DOCKER_GID=$${OPSDECK_DOCKER_GID:-$(DOCKER_SOCKET_GID)} $(HOST_COMPOSE) up -d --build --wait

docker-gpu-up: init ## Start host monitoring with NVIDIA utility access (requires Toolkit)
	@test -S '$(DOCKER_SOCKET)' || { echo 'Docker socket missing.' >&2; exit 1; }
	OPSDECK_DOCKER_GID=$${OPSDECK_DOCKER_GID:-$(DOCKER_SOCKET_GID)} $(GPU_COMPOSE) up -d --build --wait

docker-sandbox-up: init ## Start the portable app with isolated namespaces and localhost port publishing
	$(COMPOSE) up -d --build --wait

docker-status: ## Show container status
	$(COMPOSE) ps

docker-logs: ## Follow application container logs
	$(COMPOSE) logs --tail=100 -f opsdeck

docker-down: ## Stop the app while retaining its history volume
	$(COMPOSE) down

docker-restart: ## Restart the running app without changing its deployment mode
	$(COMPOSE) restart opsdeck

docker-backup: ## Back up container SQLite data inside its persistent volume
	$(COMPOSE) exec opsdeck python -m deploy.backup --source /data/opsdeck.sqlite --output /data/backups/opsdeck-$$(date -u +%Y%m%dT%H%M%S).sqlite
