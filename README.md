# OpsDeck

A single-host infrastructure workspace with a React frontend, FastAPI backend, native Linux collectors, retained SQLite history, and an audited container-action workflow.

## What it shows

- Host CPU, physical cores and hardware threads, load averages, available RAM, page cache, swap, uptime, and top processes by resident memory.
- Filesystem capacity and inode use; physical disk read/write rates, IOPS, average latency, and busy time.
- Network interface throughput, negotiated link speed when available, errors, and drops.
- Linux pressure stalls, available temperature sensors, and systemd service states.
- NVIDIA GPU utilization, VRAM, temperature, power draw, power limit, and driver version.
- Docker engine details, container state, per-container CPU/RAM, image-layer size, volume count, and build-cache usage.
- GitLab recent and active pipelines, job duration, queue duration, runner assignment, and runner Prometheus measurements.
- Threshold alerts, timestamped events, optimization recommendations with measured evidence, JSON snapshot export, and authenticated Prometheus gauges.

Missing integrations are displayed explicitly. There are no fabricated live metrics or demo fallback values. GitLab is read-only.

## Local development

Requires Node 24+, Python 3.12+, and a Linux host for all host collectors.

```bash
python3 -m venv .venv
.venv/bin/pip install -r backend/requirements.lock
npm ci --prefix frontend
cp .env.example .env
# Set OPSDECK_TOKEN to a random secret of at least 32 characters.
.venv/bin/python -m backend.run
# In another terminal:
npm run dev --prefix frontend
```

Open the Vite URL and enter the server access token. The token is stored in browser session storage, cleared at sign-out, and not placed in URLs. API and frontend use the same origin in production; development proxies `/api` to localhost:8080.

Build and run the production application:

```bash
npm run build --prefix frontend
.venv/bin/python -m backend.run
```

Open `http://127.0.0.1:8080`. Use **one backend worker**: a worker owns the collectors and history sampler. This application monitors one host; it is not a distributed telemetry cluster.

## Configuration

The launcher reads `.env` without evaluating shell code. Existing process environment values take precedence. Keep `.env` private (mode 600) and out of source control.

| Variable | Default | Purpose |
|---|---|---|
| `OPSDECK_TOKEN` | Required | One shared operator access token, at least 32 random characters |
| `OPSDECK_BIND` | `127.0.0.1` | Listen address; use the host's Tailscale address for private access |
| `OPSDECK_PORT` | `8080` | HTTP port |
| `OPSDECK_DB` | `./data/opsdeck.sqlite` | SQLite history and audit database |
| `OPSDECK_SAMPLE_SECONDS` | `10`, minimum `5` | Host/history sampling interval |
| `OPSDECK_RETENTION_DAYS` | `30` | Metric and threshold-event retention |
| `OPSDECK_ACTIONS` | `false` | Enable opted-in container actions |
| `DOCKER_HOST` | Local Unix socket | Docker SDK connection |
| `GITLAB_URL` | Unconfigured | HTTPS GitLab instance URL |
| `GITLAB_TOKEN` | Unconfigured | Server-only token with `read_api` scope and access to selected projects |
| `GITLAB_PROJECT_IDS` | Unconfigured | Comma-separated project IDs or namespace/project paths; up to 8 |
| `RUNNER_METRICS_URL` | `http://127.0.0.1:9252/metrics` | Runner metrics endpoint, never proxied to the browser |
| `OPSDECK_RUNNER_FACTS` | `./data/runner-facts.json` | Optional sanitized runner facts exported by an administrator |
| `OPSDECK_SERVICES` | Docker, runner, Tailscale units | Comma-separated systemd `.service` unit names, up to 12 |

Restart the application after configuration changes. Integration credentials never appear in snapshots or exports. No token is needed for the minimal `/healthz` response; all `/api/*` data endpoints require a bearer token. The dashboard is deliberately one operator role; individual user accounts and role-based authorization are not implemented.

## Deployment

Run natively on the monitored Linux host. Containerized execution without explicit host mounts would report the container's environment instead of complete host metrics.

Online deployment after pulling this repository from GitHub:

```bash
# Use safe-git for repository operations in this workflow.
safe-git clone <your-personal-github-repository-url> ~/opsdeck
cd ~/opsdeck
python3 -m venv .venv
.venv/bin/pip install -r backend/requirements.lock
npm ci --prefix frontend
npm run build --prefix frontend
bash deploy/install-user.sh
```

`install-user.sh` creates a random access token if `.env` does not exist and installs a user systemd service with a 1 GiB memory ceiling and one CPU quota. It does not restart Docker or the runner. Retrieve the token from the private `.env` file. To expose the dashboard privately, set `OPSDECK_BIND` to the host's Tailscale IP and restart `systemctl --user restart opsdeck`.

For hosts without pip, npm, or working package downloads, build an offline bundle on a development machine:

```bash
bash deploy/build-bundle.sh
scp dist/opsdeck-linux-x86_64-py312.tar.gz <host>:~/
# On a Linux x86_64 / Python 3.12 host:
mkdir -p ~/opsdeck
tar -xzf ~/opsdeck-linux-x86_64-py312.tar.gz -C ~/opsdeck
cd ~/opsdeck
bash deploy/install-user.sh
```

The bundle includes the frontend and binary Python wheels. It bootstraps pip into a `venv --without-pip` environment without sudo or downloads. It never includes `.env`, SQLite files, existing host reports, or credentials. Bundles are ignored by Git; build one for the target Python/architecture rather than transferring a development virtual environment.

An administrator must enable lingering for user-service boot persistence:

```bash
sudo loginctl enable-linger <service-user>
```

Alternatively, use `deploy/opsdeck.service.example` as a system service after creating a dedicated account and installing the application in `/opt/opsdeck`. Choose one deployment mode. Docker socket membership is powerful host access even when UI actions are disabled; grant it only to a trusted service account. Bind privately, or terminate HTTPS through an authenticated reverse proxy before exposing the app externally.

## Container actions

Only **stop** and **restart** are implemented. There is no arbitrary command execution, prune, disk formatting, GitLab mutation, or runner-settings editor in the web UI.

1. An administrator enables `OPSDECK_ACTIONS=true`.
2. A container explicitly opts in using the label `opsdeck.managed=true`.
3. The operator requests a preview for its full container ID.
4. The backend validates ownership and returns a 60-second confirmation nonce.
5. The operator types the exact operation and container name.
6. The backend consumes the nonce once, revalidates the current container, records intent, and calls Docker.
7. The result is recorded in the audit history. Live state refreshes independently.

Containers with GitLab runner labels, names beginning `runner-`, or `opsdeck.application=opsdeck` are excluded. Container labels are opt-in policy for a trusted operator, not an isolation boundary against users with Docker socket access. Failed or timed-out Docker requests may have reached Docker: inspect current state before retrying. Action records persist beyond metric retention; back up the database using SQLite's backup API.

## Measurement details and limits

- Host data samples every 10 seconds by default; Docker, GPU, runner, and services no faster than every 15 seconds; GitLab every 60 seconds. Slow integrations run independently.
- API reads use cached snapshots; opening more dashboards does not launch more collectors.
- Rates require two samples. Missing measurements remain null. Container CPU can exceed 100% across multiple cores.
- Network history sums physical/non-virtual interfaces, excluding Docker bridges, veth, and Tailscale to reduce double counting. All interface rates remain visible individually.
- GPU history charts the first GPU. The hardware page shows each detected GPU.
- History returns at most 600 averaged buckets, with peak fields retained in the API. The chart labels its averages.
- Docker stats cover at most 64 running containers; inventory is capped at 200. Disk usage is cached for five minutes. Docker logs and environment variables are intentionally not collected.
- GitLab covers the latest 10 pipelines plus up to 20 running and 20 pending pipelines per configured project. Jobs cover active and latest pipelines, at most 300 jobs per pipeline. Counts describe that sample, not the entire GitLab instance. Completed pipeline timings are fetched for the latest three.
- Runner numeric Prometheus series are aggregated by metric name across labels. Histogram bucket totals are not interpreted as queue latency. Job queue durations come from the GitLab Jobs API.
- Blank device inventory does not establish permission to format a drive. Optimization items are recommendations, not records of completed changes.
- The dashboard provides threshold events and collector health; distributed application tracing, centralized log search, SMART health, cache hit rates, alert delivery, and fleet monitoring require additional integrations.

## Runner optimization tools

These are administrator CLI tools, independent of the web application. They are prepared changes and must be benchmarked against real mixed workloads.

`deploy/runner_admin.py` validates TOML, backs up before applying, targets a single named runner, preserves other registrations and existing limits unless explicitly changed, and exports safe facts without runner authentication tokens:

```bash
# Preview first; only safe settings are printed.
sudo python3 deploy/runner_admin.py --runner '<runner-name>' --concurrent 8 --requests 4 --metrics
# Apply the reviewed candidate and export facts:
sudo python3 deploy/runner_admin.py --runner '<runner-name>' --concurrent 8 --requests 4 --metrics --apply --facts ./data/runner-facts.json
# Optional measured workload budget, not a default for every project:
sudo python3 deploy/runner_admin.py --runner '<runner-name>' --concurrent 8 --cpus 6 --memory 32g
```

An existing runner limit is preserved. Use `--limit N` explicitly if it should change. Concurrency settings reload automatically; starting a metrics listener may require a graceful runner restart. Do not expose its listener publicly.

`tune-runner-host.sh` adds NVMe preflight, explicit device confirmation, checks for unsupported Docker storage layouts and unrelated active containers, capacity checks, bounded draining, service mount guards, and periodic trim. Copy the **whole repository**, including `deploy/runner_admin.py`, when using its concurrency phase. NVMe migration is currently specific to `/dev/nvme0n1`, `/dev/nvme1n1`, `/var/lib/docker`, and `/cache`; adapt it for other hosts.

```bash
sudo bash tune-runner-host.sh nvme-preflight
sudo bash tune-runner-host.sh nvme --confirm-unused-devices
```

Migration formats the confirmed blank devices and pauses every project on the runner. It refuses formatting when partitions, signatures, mounts, or device holders are detected. This is not an assurance that no other team owns the devices. Failures leave services stopped for inspection instead of falling back to stale HDD copies. Review fstab, mounts, and the printed backups before restarting services.

The HDD copies are **pre-migration snapshots**. They do not contain later changes. The rollback command requires `--confirm-original-snapshot`; reverse-sync current state during a drained maintenance window before reverting if later data must be preserved. A drain timeout can leave `/run/systemd/system/gitlab-runner.service.d/90-opsdeck-drain.conf` in place; inspect running jobs before removing it and reloading systemd.

## Verification

```bash
.venv/bin/python -m pytest -q
npm test --prefix frontend
npm run build --prefix frontend
bash -n tune-runner-host.sh deploy/*.sh
```

Browser tests live in `frontend/e2e/` and exercise the running API/frontend, authentication, navigation, degraded integrations, and the typed action flow. GitHub Actions runs backend, frontend, and browser checks on pushes and pull requests. No workflow deploys or changes a shared runner automatically.
