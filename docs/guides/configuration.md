# Configuration

`make init` creates `.env` with a generated operator token and mode 600. Existing files are preserved. Configuration and databases are excluded from Git and Docker build contexts.

Native mode loads `.env` without evaluating shell code. Whitespace around `=` and quoted values are supported; variable interpolation is not. Existing process environment values take precedence. Compose reads the file using Docker's env-file semantics; avoid relying on interpolation inside secret values. Restart after changing environment settings.

## Application

| Setting | Default | Use |
|---|---|---|
| `OPSDECK_TOKEN` | Required | Random secret of at least 32 characters; one operator role |
| `OPSDECK_ADMIN_FILE` | `./data/admin.json` native; `/data/admin.json` in central Compose | Optional single administrator username/password account, created with `python -m deploy.admin`; restart after creating or resetting it |
| `OPSDECK_METRICS_TOKEN` | Empty | Central mode, optional: a separate secret of at least 32 characters accepted only by `GET /api/fleet/metrics`, so Prometheus never holds the operator token |
| `OPSDECK_BIND` | `127.0.0.1` native | Listen address; host Compose honors it |
| `OPSDECK_PORT` | `8080` | Native/host port; portable Compose publishes this external port |
| `OPSDECK_DB` | `./data/opsdeck.sqlite` native | SQLite path; Compose sets `/data/opsdeck.sqlite` |
| `OPSDECK_FINDINGS_PATH` | `./data/findings.json` native | Private survey archive; Compose sets `/data/findings.json`; reloads every 30 seconds |
| `OPSDECK_SAMPLE_SECONDS` | `10`, minimum `5` | Host/history sampling interval |
| `OPSDECK_RETENTION_DAYS` | `30`, minimum `1` | Metrics and threshold-event retention |
| `OPSDECK_TREND_RETENTION_DAYS` | `366`, never below `OPSDECK_RETENTION_DAYS` | Central server: 15-minute fleet pulse rollups (CPU, memory, GPU averages per host) behind the 7-day, 30-day, and year pulse windows |
| `OPSDECK_ACTIONS` | `false` | Opt-in stop/restart operations |
| `OPSDECK_VERSION` | `SOURCE_COMMIT` file, else `dev` | Build label reported by `/healthz`, the fleet overview, and `opsdeck_build_info`; when unset, the first line of a `SOURCE_COMMIT` file at the repository root is used |
| `OPSDECK_ENV_FILE` | `.env` native | Alternate launcher config file; image uses `/data/config.env` |
| `OPSDECK_SERVICES` | Docker, runner, Tailscale units | Up to 12 comma-separated `.service` unit names |
| `OPSDECK_SERVICES_FILE` | Empty | Optional sanitized native service snapshot, instead of direct DBus reads; see deployment guide |
| `OPSDECK_DOCKER_TIMEOUT` | `10`, range `2..60` | Seconds to wait for each Docker API call; disk usage uses `max(30, 3 x value)`. Raise it when `time docker ps` is slow on the host |

Central mode can use one administrator username/password account, with salted scrypt password hashing and 12-hour revocable browser sessions. Without an administrator file, sign-in uses the shared operator token. The operator token remains a private API/recovery credential in either mode. Individual accounts and roles are not implemented. See [administrator setup](../operations/fleet.md#administrator-username-and-password). Source code can be cloned anonymously from the public repository.

## GitLab

| Setting | Use |
|---|---|
| `GITLAB_URL` | HTTPS URL of your GitLab instance |
| `GITLAB_TOKEN` | Server-only access token with `read_api` and access to the projects |
| `GITLAB_PROJECT_IDS` | Up to 8 comma-separated IDs or namespace/project paths |

Use a dedicated read-only integration token. Pipeline and job requests are GET-only. Redirects are not followed with that credential. GitLab error messages returned to browsers are controlled summaries rather than raw HTTP exceptions.

Without all three settings, the integration stays unconfigured. A configured project with insufficient access is marked degraded and reports the affected project. Latest 10 pipelines, up to 20 running and 20 pending per project, and up to 300 jobs per selected pipeline are sampled every 60 seconds. Completed timing details cover the latest three pipelines.

## Runner telemetry

| Setting | Default |
|---|---|
| `RUNNER_METRICS_URL` | `http://127.0.0.1:9252/metrics` |
| `OPSDECK_RUNNER_FACTS` | `./data/runner-facts.json` native; `/data/runner-facts.json` Compose |

Enable the runner's local metrics listener and use its actual address. In portable Compose, localhost refers to the application container. The host override shares the node's network, so the default URL reaches the node's listener.

Export safe configuration facts with the administrator helper:

```bash
sudo python3 scripts/runner/admin.py --export-only --facts ./data/runner-facts.json
```

With `deploy/docker/compose.services.yaml`, the host `data/` directory is already mounted read-only and facts are read from `/host-services/runner-facts.json`. See [Runner telemetry](../operations/runner-telemetry.md) for the metrics-only setup command.

For Compose without that override, copy those facts into the named volume:

```bash
docker compose --project-directory . -f deploy/docker/compose.yaml cp ./data/runner-facts.json opsdeck:/data/runner-facts.json
```

Only approved fact fields are returned; runner authentication tokens are not read by the dashboard. Prometheus series are summed across labels by metric name; histogram buckets are not treated as queue latency.

## Docker, host scope, and GPUs

| Setting | Use |
|---|---|
| `DOCKER_HOST` | Docker SDK endpoint; default Unix socket |
| `DOCKER_SOCKET` | Host socket path for Makefile/host Compose; default `/var/run/docker.sock` |
| `OPSDECK_DOCKER_GID` | Socket group ID added to the non-root container; Make detects it |
| `OPSDECK_HOST_ROOT` | Mounted node root; host Compose sets `/host` |
| `OPSDECK_PROCFS_PATH` | Procfs root; host Compose sets `/host/proc` |
| `OPSDECK_SCOPE` | `native`, `container`, or `host`; selected by deployment mode |
| `OPSDECK_PUBLISH_IP` | Portable Compose published IP; defaults to localhost |

Host mode reads PID 1's mount table and maps filesystem paths under the mounted host root. It uses the mounted procfs for RAM, counters, pressure, and process observations. Host networking aligns interface metadata with the node. Host systemd reads use its mounted system-bus socket when available.

NVIDIA telemetry uses `nvidia-smi`. Native mode uses the installed node driver. GPU Compose adds NVIDIA utility capability through Container Toolkit; no CUDA compiler or compute workload is bundled.

## Fleet configuration

Set `OPSDECK_MODE=central` on the hosted server and use a per-host `OPSDECK_AGENT_TOKEN` with `OPSDECK_SERVER_URL` on each runner. See [Fleet deployment](../operations/fleet.md) for the complete agent, queue, TLS, and server settings. The default remains `standalone`.

Set `OPSDECK_FLEET_URL` on a standalone dashboard to enable its header's **All hosts** link to the central dashboard. Use an HTTPS origin without credentials, a path, or query parameters. HTTP loopback origins are accepted for development. The central server retains its own login; the local token is not shared.
