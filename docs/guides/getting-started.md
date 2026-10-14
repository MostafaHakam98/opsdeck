# Getting started

## Clone without a GitHub account

The source repository is public. Anonymous HTTPS cloning works on a workstation, a server, or a cluster login node:

```bash
safe-git clone https://github.com/MostafaHakam98/opsdeck.git
cd opsdeck
make help
```

`safe-git` is the wrapper used in this workspace. On a cluster without that wrapper, use its normal Git installation for the same public HTTPS URL. Application access uses a server token; cloning the source does not grant access to another node's dashboard.

## Linux host monitoring with Docker

Requires GNU Make, Python 3.12+ for configuration initialization, Docker Engine, and Compose 2.30+; kernel 5.12+ is recommended for recursive read-only host mounts.

```bash
make init
make docker-up
make docker-status
```

Open `http://127.0.0.1:8080`. Read the generated `OPSDECK_TOKEN` from the private `.env` file and enter it on the sign-in screen. `make init` preserves an existing file and token; it also creates the ignored `.tmp/` directory. The container runs as a non-root user and records history in the named `opsdeck_data` volume.

With an NVIDIA GPU and configured NVIDIA Container Toolkit:

```bash
make docker-gpu-up
```

For a portable app preview without host mounts or Docker socket access:

```bash
make docker-sandbox-up
```

This mode is labeled **Container view**. Some kernel counters can still describe the host; this mode does not claim complete node visibility.

## Native installation

Requires Python 3.12+ with venv support, Node 24+, npm, and Make:

```bash
make setup
make run
```

The production dashboard and API share port 8080. Stop the foreground process with Ctrl+C. Keep one sampler worker per instance.

For source changes, use separate terminals:

```bash
make dev-api
make dev-ui
```

Open Vite at `http://127.0.0.1:5173`; its `/api` proxy targets port 8080. The development API command binds localhost:8080 explicitly and reloads Python changes.

## First-use checklist

1. Check **Connections** for available, unavailable, and unconfigured integrations.
2. Check the **Collection scope** on **Host & hardware** before interpreting node measurements.
3. Wait for two retained samples before expecting rate charts.
4. Configure GitLab and runner metrics using the [configuration guide](configuration.md).
5. Keep actions disabled until the intended containers have opted in.
6. Take a backup before changing deployment modes or updating the application.

## Daily commands

| Task | Command |
|---|---|
| Command reference | `make help` |
| Local application health | `make health` |
| Container state | `make docker-status` |
| Application logs | `make docker-logs` |
| Restart existing container | `make docker-restart` |
| Stop, retain history | `make docker-down` |
| Native database backup | `make backup` |
| Container database backup | `make docker-backup` |
| Unit/integration tests | `make test` |
| Browser tests | `make test-e2e` |
| All local checks | `make check` |

`make health` assumes the native/host listen port is 8080 unless `OPSDECK_PORT` is set in the shell. For another port, run `OPSDECK_PORT=8083 make health`.
