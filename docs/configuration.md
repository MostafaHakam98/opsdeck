# Configuration

`make init` creates `.env` with a generated operator token and mode 600. Existing files are preserved. Configuration and databases are excluded from Git and Docker build contexts.

Native mode loads `.env` without evaluating shell code. Whitespace around `=` and quoted values are supported; variable interpolation is not. Existing process environment values take precedence. Compose reads the file using Docker's env-file semantics; avoid relying on interpolation inside secret values. Restart after changing environment settings.

## Application

| Setting | Default | Use |
|---|---|---|
| `OPSDECK_TOKEN` | Required | Random secret of at least 32 characters; one operator role |
| `OPSDECK_BIND` | `127.0.0.1` native | Listen address; host Compose honors it |
| `OPSDECK_PORT` | `8080` | Native/host port; portable Compose publishes this external port |
| `OPSDECK_DB` | `./data/opsdeck.sqlite` native | SQLite path; Compose sets `/data/opsdeck.sqlite` |
| `OPSDECK_SAMPLE_SECONDS` | `10`, minimum `5` | Host/history sampling interval |
| `OPSDECK_RETENTION_DAYS` | `30`, minimum `1` | Metrics and threshold-event retention |
| `OPSDECK_ACTIONS` | `false` | Opt-in stop/restart operations |
| `OPSDECK_ENV_FILE` | `.env` native | Alternate launcher config file; image uses `/data/config.env` |
| `OPSDECK_SERVICES` | Docker, runner, Tailscale units | Up to 12 comma-separated `.service` unit names |

The application keeps no user-account database. The shared operator token protects measurements and actions. Source code can be cloned anonymously from the public repository.

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
sudo python3 deploy/runner_admin.py --export-only --facts ./data/runner-facts.json
```

For Compose, copy those facts into the named volume:

```bash
docker compose cp ./data/runner-facts.json opsdeck:/data/runner-facts.json
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
