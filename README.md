# OpsDeck

A single-node infrastructure dashboard for Linux hosts, Docker, GitLab runners, and NVIDIA GPUs. React frontend, FastAPI backend, persistent SQLite history, and an audited container-action workflow.

## Start on a Linux node

The repository is public and can be cloned without a GitHub account:

```bash
safe-git clone https://github.com/MostafaHakam98/opsdeck.git
cd opsdeck
make init
make docker-up
```

Open **http://127.0.0.1:8080** and enter the generated access token from the private `.env` file. Requires Docker Engine, Compose 2.30+, GNU Make, and Python 3.12+. See [Getting started](docs/getting-started.md) for native setup and environments without the `safe-git` wrapper.

For NVIDIA telemetry, configure the node's NVIDIA Container Toolkit and run `make docker-gpu-up`. For a portable app preview without full host access, run `make docker-sandbox-up`.

## What you can inspect

- CPU, cores/threads, load, memory, swap, page cache, pressure stalls, temperatures, and top processes.
- Filesystem bytes/inodes, physical disks, read/write throughput, IOPS, latency, and network interfaces.
- Docker container state, CPU/RAM, retained CI worker observations, image tags, cache volumes, and build-cache usage.
- NVIDIA utilization, VRAM, temperature, power, and driver version.
- Private survey pipeline outcomes, job timing comparisons, complete source evidence, and optimization follow-ups without a GitLab connection.
- Runner telemetry and optional read-only GitLab pipeline/job integration.
- Retained charts, integration freshness, threshold alerts, optimization evidence, and action history.

Missing integrations stay explicit. The dashboard labels its collection scope. GitLab is read-only; container stop/restart actions are disabled by default and require an opt-in label, typed confirmation, current-state validation, and a one-use preview.

## Common commands

```bash
make help                  # Full command reference
make setup run             # Native production app
make dev                   # Show API/UI development commands
make test                  # Backend and frontend tests
make test-e2e              # Real browser checks; install Chromium first
make check                 # Tests, build, shell syntax, and Python compilation
make docker-build          # Build the runtime image
make docker-test           # Disposable Compose auth/persistence/host checks
make docker-status         # Container status
make docker-logs           # Application logs
make docker-down           # Stop the app, retain history
make backup                # Native SQLite backup under .tmp/backups/
make docker-backup         # Container SQLite backup
make bundle                # Offline Linux x86_64 / Python 3.12 archive
```

One application instance monitors one node. History lives in a persistent named volume under Compose, or in the configured database path natively. Source visibility does not grant access to a running node's dashboard.

## Handbook

| Guide | Purpose |
|---|---|
| [Getting started](docs/getting-started.md) | Clone, first launch, and daily commands |
| [User guide](docs/user-guide.md) | Every page, chart, threshold, and action |
| [Configuration](docs/configuration.md) | Environment reference and integrations |
| [Runner surveys](docs/surveys.md) | Private benchmark imports, recorded evidence, and current optimization checks |
| [Deployment](docs/deployment.md) | Docker, Compose, GPU, native, offline, and cluster guidance |
| [Operations](docs/operations.md) | Health, logs, backup/restore, updates, and optimization |
| [Architecture](docs/architecture.md) | Data flow, API, permissions, and limits |
| [Troubleshooting](docs/troubleshooting.md) | Diagnose startup and missing telemetry |

`.gitignore` and `.dockerignore` exclude credentials, local databases, caches, build outputs, internal host reports, and `.tmp/`. `make init` creates that scratch directory; Git intentionally does not track it.

## Deployment boundaries

Host Compose explicitly reads the Linux node's root/procfs and shares its PID/network namespaces. Docker socket access is powerful even when its filesystem mount is read-only. The app runs without privileged mode, as a non-root user, with bounded resources and a read-only application filesystem. See the deployment guide before granting node access.

Portable containers do not provide complete node visibility. Fleet aggregation, Kubernetes API metrics, centralized log search, distributed tracing, SMART health, custom threshold editing, and notification delivery are not implemented. Integration credentials remain server-side; application access uses one operator token rather than individual accounts.

GitHub Actions runs backend, frontend, browser, and container checks. It does not deploy or alter a shared runner automatically.
