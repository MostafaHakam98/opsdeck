# Troubleshooting

Start with the exact failing command and its first meaningful error. Use **Connections** to distinguish collector failure from an idle workload.

## Startup and access

| Symptom | Inspect | Resolution |
|---|---|---|
| Token validation fails at startup | `.env` exists; placeholder replaced; token has at least 32 characters | Run `make init` for a new installation or replace the placeholder in the existing file |
| HTTP 401 | Token used by this instance; browser session | Sign out and enter the current instance token |
| HTTP 429 after failed logins | Authentication-failure rate limit | Wait one minute, then use the correct token |
| Port already in use | Native process, existing Compose service, configured port | Stop the conflicting app or choose another `OPSDECK_PORT` |
| Frontend not built | `frontend/dist/index.html` | Run `make build`; Docker builds it automatically |
| Portable container cannot be reached | Published IP/port and container bind | Compose sets internal bind to all interfaces; check localhost publishing and external port |
| Host-mode health check fails on a private binding | Address exists on the host; app logs | Use the actual Tailscale/interface address in `OPSDECK_BIND`; restart |
| `services.opsdeck.gpus must be a list` | `docker compose version` | The Compose plugin is too old for the GPU override; install a newer plugin (per user under `~/.docker/cli-plugins` needs no sudo) |
| `the --mount option requires BuildKit` | `docker buildx version` | The buildx plugin is missing; install it the same way, then rebuild |

Use `make docker-logs` or `make service-logs` for process errors. Liveness can pass while an integration remains unavailable.

## Docker

**Permission denied on the socket:** verify its group with `stat -c '%g' /var/run/docker.sock`. `make docker-up` detects it; explicit Compose commands require `OPSDECK_DOCKER_GID`. For a nonstandard/rootless socket, set `DOCKER_SOCKET` in the invoking environment and use the actual path. Rootless Docker may not permit complete host namespace access; choose native mode if needed.

**Daemon unavailable:** check `systemctl status docker` on the node. During an intentional runner NVMe migration Docker may be stopped. Do not start it halfway through a storage copy; finish the maintenance procedure first.

**No containers in portable mode:** Docker socket access is deliberately absent there. Use host Compose when monitoring the node's Docker daemon is intended.

**Container CPU is empty:** rates need two samples, and stats cover at most 64 running containers. Docker stats failures do not produce invented zeroes.

## Host scope, filesystems, and services

If **Collection scope** says Container view, use the host override for node metrics. Host mode requires the mounted host procfs and an absolute host-root path; startup fails if those required inputs are missing.

Filesystems are read from host PID 1's mount table and mapped beneath `/host`. Permission-denied mounts may be omitted. New mounts may require container recreation. Kubernetes and managed-cluster restrictions can prevent the required access.

Systemd telemetry needs `systemctl` and the host system bus in host Compose. A missing bus is unavailable, not a claim that every unit is stopped. Native mode is the fallback for environments that prohibit this access. A unit with `load=not-found` is not installed under that name.

## NVIDIA

Check the node's `nvidia-smi` first. For Docker, configure NVIDIA Container Toolkit and use `make docker-gpu-up`. A missing utility is unconfigured; driver/device failures are unavailable. Some devices do not expose every temperature/power field, which remains empty.

## GitLab and runners

For an active runner with **Metrics endpoint: Unavailable**, follow [Runner telemetry](../operations/runner-telemetry.md). Metrics and sanitized configuration facts work without a GitLab API connection. Use **Worker state** to switch between running and retained containers.

- Set HTTPS `GITLAB_URL`, dedicated `read_api` token, and accessible project IDs. The browser receives no integration token.
- Check project permissions when one project is degraded. Rate/timeouts are surfaced as controlled errors.
- In portable Docker, localhost points to the container; host mode reaches the node's local runner metrics listener.
- Queue/duration fields can be absent in GitLab responses. Empty values are retained, not replaced with estimates.
- Export runner facts separately if configuration budgets are missing. Do not copy the runner's secret-bearing TOML file into application data.

## Agent collector shows unavailable

The host page shows each collector's own message, and fleet alerts repeat it. Diagnose on the host first; every command below is read-only.

**Docker: "Docker API did not answer within 10s while listing containers (ReadTimeout)".** The daemon is reachable but slow.

```bash
time docker ps
time docker system df
systemctl status docker
```

If `docker ps` takes several seconds, raise `OPSDECK_DOCKER_TIMEOUT` (seconds, default 10, range 2..60) in `.env.agent` and recreate the agent. Only listing containers is essential: slow engine info, per-container stats, image lists, or disk usage mark Docker **degraded** with a message such as "Container stats timed out for 3 of 12 running containers" or "Docker disk usage timed out; showing the last result from 14 min ago", and the rest of the data is kept. Disk usage runs at most every 5 minutes with its own longer timeout (`max(30, 3 x OPSDECK_DOCKER_TIMEOUT)`). "Docker socket permission denied" means the agent container lacks the socket's group: check `stat -c '%g' /var/run/docker.sock` and set `OPSDECK_DOCKER_GID` (`make docker-agent-up` detects it).

**Runner: "No runner metrics listener at 127.0.0.1:9252".** Nothing listens on the configured port, so the runner source is shown as not configured rather than failing.

```bash
curl -s 127.0.0.1:9252/metrics | head
systemctl status gitlab-runner
```

If GitLab Runner runs on this host, enable its loopback listener (sets `listen_address = "127.0.0.1:9252"` in `/etc/gitlab-runner/config.toml` and restarts the runner gracefully, preserving concurrency and job limits):

```bash
sudo bash scripts/runner/tune-runner-host.sh metrics
```

If the host runs no runner, set `RUNNER_METRICS_URL=` (empty) in `.env.agent`. Timeouts and HTTP errors from a listener that does exist stay **unavailable** with the exception class.

**Services: "The container cannot reach the host's systemd bus".** Container agents read unit state through the host's DBus socket, which some host policies deny. Check the units directly with `systemctl status docker gitlab-runner`. Then either run the host service exporter once per minute from the deployment account and start the agent with the services override:

```bash
# Example crontab entry (replace the absolute project path):
# * * * * * cd /path/to/opsdeck && /usr/bin/python3 -m deploy.export_services --output data/service-status.json
make docker-agent-up COMPOSE_EXTRA=deploy/docker/compose.services.yaml
```

or set `OPSDECK_SERVICES=` (empty) in `.env.agent` to stop monitoring services. Other `systemctl` failures include the first line of its error output after the exception class.

**Monitored collectors.** For a collector a host does not run, uncheck it under **Host settings > Monitored collectors** instead of leaving a permanent alert. The host page then shows it as "not monitored", and it raises no alerts and no Prometheus alert counts. The host collector is always monitored. The change applies on the server immediately and is recorded in **Fleet audit** as "Host settings changed" with "ignored sources".

## History and backups

**Chart still empty:** wait for two retained samples and verify that the host source is healthy. History sampling skips missing host data.

**History write failed:** inspect free bytes, inodes, and database directory ownership. Compose writes only the named `/data` volume as UID 12001. Do not remove the volume to fix a permissions issue.

**History disappears after moving deployment:** native mode and Compose use different database locations. Restore a verified backup into the new location; merely starting another mode does not migrate it.

**Backup fails:** confirm the source path exists, choose a new destination, and check write permissions. The helper refuses overwriting an existing backup.

## Actions

Actions need server enablement, a managed label, a running eligible container, and exact confirmation within 60 seconds. A consumed/expired nonce requires a new preview. Changed container name/labels/state causes revalidation refusal. After a Docker timeout, inspect live state and the audit trail before retrying.

## Development checks

Install dependencies with `make setup`; install Chromium with `npm exec --prefix frontend -- playwright install chromium` before `make test-e2e`. On Linux, Playwright may also need system browser libraries. Run backend tests directly if isolating a failure: `make test-backend`.
