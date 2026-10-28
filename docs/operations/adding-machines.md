# Add machines and their runners

This guide installs one host workspace API and one outbound agent per machine. It does **not** automatically register a new GitLab runner. Start with one selected machine, prove the acceptance checks, and then repeat.

## Before installation

Record actual hostname, owner, cluster/network, OS, CPU/RAM/disks/GPU, existing runner processes/services, number of registrations, metrics listeners, current jobs, and intended build/cache paths. A cluster login node is not automatically the correct runner host.

Check that the machine can reach `https://opsdeck.example.com` on outbound HTTPS with trusted certificates. No inbound application or metrics ports are needed from EC2. SSH is for administration, not ongoing fleet delivery. Keep runner metrics on loopback.

For the Docker path below, use Linux, Docker Engine, Compose 2.30+, GNU Make, Python 3.12+, and an account intentionally allowed to use the Docker socket. Host PID/network/filesystem visibility and socket access are deliberate grants. An institutionally restricted compute node may need the native path or an administrator-approved deployment instead.

## Step 1 — create this machine's fleet identity

Open **Enroll host** on the central dashboard. Enter a recognizable host name and cluster/network, then click **Create agent credential**. Save the displayed server URL and host credential once in a protected place.

Use the central dashboard’s **Enroll host** form; one credential belongs to one machine.

Do not reuse another machine’s credential. Several registrations in one GitLab Runner process still use a single host enrollment. A new physical/virtual machine needs another enrollment.

## Step 2 — prepare the checkout and separate private files

For a new machine using the reviewed feature branch:

```bash
safe-git clone --branch FT-ui-overhaul-HA https://github.com/MostafaHakam98/opsdeck.git
cd opsdeck
make init
cp .env.agent.example .env.agent
chmod 600 .env .env.agent
```

Use the reviewed branch or release commit for your deployment. An unpushed development commit cannot be fetched on a new host.

`make init` generates a machine-local `OPSDECK_TOKEN` in `.env` and preserves existing files. Keep this machine's workspace settings in `.env`:

```dotenv
OPSDECK_MODE=standalone
OPSDECK_BIND=127.0.0.1
OPSDECK_PORT=8080
OPSDECK_FLEET_URL=https://opsdeck.example.com
```

Keep the generated local token. If port 8080 is occupied, choose a free loopback port here and use it consistently below. Do not overwrite an existing OpsDeck deployment's configuration or bind it publicly just to reach the central dashboard.

Edit `.env.agent` privately, replacing the enrollment placeholders and adding the local workspace pair:

```dotenv
OPSDECK_SERVER_URL=https://opsdeck.example.com
OPSDECK_AGENT_TOKEN = <the credential issued for this machine>
OPSDECK_SAMPLE_SECONDS=10
RUNNER_METRICS_URL=http://127.0.0.1:9252/metrics
OPSDECK_WORKSPACE_URL=http://127.0.0.1:8080
OPSDECK_WORKSPACE_TOKEN = <this machine's OPSDECK_TOKEN from .env>
```

Use the local workspace token here, not the administrator password or central recovery token. Preserve the template's queue settings. Do not source private env files as shell scripts; the application has a non-evaluating loader, and `.env` can include whitespace around `=`.

## Step 3 — start the local workspace under its own project

```bash
COMPOSE_PROJECT_NAME=opsdeck-workspace make docker-up
curl --fail --silent --show-error http://127.0.0.1:8080/healthz
```

This starts the complete local API/dashboard with a persistent workspace volume, host metrics, and loopback access. Use the configured port if different. `/healthz` proves liveness, not that all collectors are healthy.

Then start the agent under a **different** project:

```bash
COMPOSE_PROJECT_NAME=opsdeck-agent make docker-agent-up
```

These project names create separate containers and volumes. Never run the workspace and agent commands under the same Compose project: the latter replaces the service command and can disconnect the full host workspace. Do not share the agent spool across identities.

Compose uses `restart: unless-stopped`; the Docker service must itself start at boot. Recreating an agent is necessary after changing its environment; a plain Docker restart does not reload env-file values.

Inspect without printing credentials:

```bash
docker ps --filter name=opsdeck --format '{{.Names}} {{.Status}}'
docker logs --tail 50 opsdeck-agent-opsdeck-1
```

The agent should repeatedly post accepted telemetry and poll the workspace relay. Keep logs private; never print full container environments or the raw GitLab Runner TOML to a shared terminal/report.

## Step 4 — connect runner telemetry and sanitized facts

**Existing runners:** keep their registrations and tokens. OpsDeck monitors them; it does not need you to register them again.

**No GitLab Runner yet:** outside OpsDeck, an administrator installs/registers the runner in GitLab and selects executor, tags, project access, and protection policy. That is separate from enrolling the machine in OpsDeck. Follow the organization's runner workflow and [GitLab's registration documentation](https://docs.gitlab.com/runner/register/).

First check whether metrics are already available:

```bash
curl --fail --silent http://127.0.0.1:9252/metrics | head
```

If missing and this is the supported `gitlab-runner` system service with `/etc/gitlab-runner/config.toml`, the repository's metrics-only helper can configure a loopback listener and export safe facts:

```bash
sudo bash scripts/runner/tune-runner-host.sh metrics
```

This phase does not change scheduling limits. A new listener can require draining active jobs before the runner restarts. The script preserves jobs with SIGQUIT, waits up to one hour, and does not force-stop them. Use a suitable maintenance window. Existing custom listener addresses require review rather than being overwritten.

`admin.py` needs Python 3.11+ for `tomllib`. When the host's `python3` is older (for example Ubuntu 20.04), the script runs it in a throwaway `python:3.12-slim-bookworm` container with no network that mounts only the checkout and the runner configuration directory. Set `OPSDECK_ADMIN_IMAGE` to use another Python 3.11+ image. On such hosts, run the direct `admin.py` commands below the same way, or rerun the `metrics` phase, which refreshes the facts once metrics already work.

Export facts independently when metrics already work or after capacity changes:

```bash
sudo python3 scripts/runner/admin.py --export-only --facts ./data/runner-facts.json
docker cp ./data/runner-facts.json opsdeck-workspace-opsdeck-1:/data/runner-facts.json
docker cp ./data/runner-facts.json opsdeck-agent-opsdeck-1:/data/runner-facts.json
```

The export contains allowlisted names/executors/budgets only, no registration tokens. These file copies match the default paths in the Docker services above; adapt names/paths for an existing deployment. The facts file is dated, so refresh it after edits.

### Multiple registrations versus multiple independent services

Several `[[runners]]` registrations in one configuration share that process's global `concurrent` limit and loopback metrics listener. One agent can represent the host.

If a host runs several independent GitLab Runner processes or containers with different metrics listeners/configurations, inventory all of them explicitly. The current collector has one configured `RUNNER_METRICS_URL` and one facts file; it does not automatically merge every independent daemon. Choose and label the monitored scope, use external Prometheus per endpoint, or plan collector support before claiming complete coverage. Do not create duplicate host identities simply to hide that limitation.

## Step 5 — optional systemd service export and GPU telemetry

If the container cannot query the systemd bus, use the existing read-only service-export override:

```bash
python3 -m deploy.export_services --output data/service-status.json \
  --services docker.service,gitlab-runner.service
COMPOSE_PROJECT_NAME=opsdeck-workspace make docker-up \
  COMPOSE_EXTRA=deploy/docker/compose.services.yaml
COMPOSE_PROJECT_NAME=opsdeck-agent make docker-agent-up \
  COMPOSE_EXTRA=deploy/docker/compose.services.yaml
```

Schedule the export once per minute using that deployment account's timer/cron and absolute checkout paths. The service reader rejects stale exports after about two minutes. `--services` must list exactly the units in the workspace's `OPSDECK_SERVICES` (the template default also includes `tailscaled.service`); if one is missing from the export, the source reports `unavailable (ValueError)`. Change either list so they match. This override also reads sanitized runner facts from host `data/`, so refresh the export after configuration changes.

For NVIDIA hosts, first verify native `nvidia-smi` and the approved NVIDIA Container Toolkit setup, then apply the documented GPU override to the workspace and the agent, preserving their existing overrides and separate project names. Absence of NVIDIA tools is not proof that the machine has no GPU. Hosts without that integration can leave GPU unmonitored.

## Step 6 — prove successful enrollment

In the central dashboard:

- [ ] **All hosts:** the intended name/cluster appears exactly once and becomes Online.
- [ ] **Agent access:** hostname, scope, and timestamp match the actual machine.
- [ ] **Overview:** real CPU/RAM/filesystem values appear, without workspace 503s.
- [ ] **Connections:** source availability matches reality; missing integrations have explanations.
- [ ] **Docker:** the expected node's containers and Docker data root are visible.
- [ ] **Runner stack:** service and metrics are available, shared limit is correct, and the facts timestamp/scope are understood.
- [ ] A representative job appears in the expected observations; shell jobs are not required to create Docker worker rows.
- [ ] After at least two retained resource samples, the local history chart renders.
- [ ] After an ordinary agent recreation, the same fleet identity reconnects and its spool/history are retained.
- [ ] Current GitLab timing integration is healthy if queue/outcome diagnosis is required.

From an authenticated central API client, `GET /api/fleet/nodes/<id>` should report `workspace_connected: true`. The existence of an Online label alone does not satisfy the workspace check.

## Step 7 — current GitLab timings

On the selected machine's **Connections** page, configure GitLab URL, dedicated read-only integration credential, and the relevant projects. This is per host workspace; configuring one does not automatically aggregate every host's GitLab results.

Wait for polling and verify actual job timestamps/outcomes and runner assignments. Tokens stay in the host's private integration file. Do not confuse the read-only GitLab token with its runner-registration token or the central administrator password.

## Optional: enable reviewed Operations

Check the selected host’s Operations capabilities first. Install the helper only on hosts where it is missing; these instructions do not enable it automatically.

For a supported root-managed runner configuration, the documented installation is:

```bash
sudo bash deploy/native/install-runner-control.sh
getent group opsdeck-control
```

The installer creates a narrow helper service/socket and sanitized facts. Set `OPSDECK_OPERATIONS=true` and `OPSDECK_CONTROL_GID=<the group's numeric GID>` in the **workspace** `.env`, then recreate only that workspace with `deploy/docker/compose.control.yaml` last in its current override list. Example for the simple default host stack:

```bash
export OPSDECK_DOCKER_GID="$(stat -c '%g' /var/run/docker.sock)"
docker compose --project-directory . -p opsdeck-workspace \
  -f deploy/docker/compose.yaml \
  -f deploy/docker/compose.host.yaml \
  -f deploy/docker/compose.control.yaml up -d --no-build --wait
```

Preserve any services/GPU/build overrides before the control override. Do not add it to the central EC2 service. Container stop/restart controls are a separate `OPSDECK_ACTIONS` opt-in and require eligible labels; enabling Operations does not enable those actions.

Verify **Operations → runner helper available**, review a candidate preview, read the before/after values and shared-host impact, type its exact confirmation, execute, and verify new live facts plus audit. Capacity reductions let current jobs finish; the helper does not implement arbitrary remote shell administration.

## Native alternative

A full native workspace needs the built frontend and backend dependencies. Use the repository's `make setup build service-install` workflow for that local service, deliberately granting only the necessary collector access. Put the same local API URL/token pair in `.env.agent` and install the agent with `make agent-install`.

`make agent-install` alone only installs the outbound agent. It does not install the complete workspace API/frontend. For boot persistence of user services, an administrator may need `loginctl enable-linger <deployment-user>`. See the maintained [fleet guide](fleet.md) and [deployment guide](deployment.md) for the supported environments.

## Troubleshooting

| Symptom | What it means / next check |
|---|---|
| Waiting forever | No telemetry with the current credential yet. Check agent process, HTTPS origin, certificate trust, credential, host time, and logs. |
| Agent 401 | Wrong/revoked/rotated per-host credential. Update the private agent file and recreate; do not substitute the central token. |
| Online but workspace 503 | Telemetry works, relay does not. Check local API, loopback bind/port, workspace URL/token, agent env reload, and relay polling. |
| Workspace 502 | Relay is present but local request failed. Check local API reachability/authentication and response size. |
| Workspace 504 | No reply before timeout. A submitted mutation may have run; inspect audit/state before retrying. |
| Workspace 429 | Per-host/global relay request bound reached. Let outstanding requests finish; investigate slow/stuck local requests rather than adding central workers. |
| Docker permission denied | Check the socket and its group membership in both services. A read-only socket mount does not make the Docker API inherently read-only. |
| Runner unavailable | Verify actual process/listener address; native/host networking must reach it. Do not infer service failure solely from a disabled metrics listener. |
| Services stale | Export timer/cron stopped, path mismatch, or snapshot older than two minutes. |
| Hardware looks container-scoped | Wrong deployment mode/mounts. Verify Host collection scope before trusting node-wide claims. |
| Facts disagree with live limit | Refresh sanitized configuration export; inspect fresh helper state where available. |
| GitLab unknown outcomes | Configure project access/timings; Docker exit observations do not supply authoritative pipeline outcomes. |

Repeat the same acceptance checks for each new machine. Keep inventories of machine identity, owner, cluster, selected runner scope, deployment project names, local API port, and backup location without recording secrets in shared documentation.
