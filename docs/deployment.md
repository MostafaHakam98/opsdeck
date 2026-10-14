# Deployment

## Choose a mode

| Mode | Command | Scope |
|---|---|---|
| Linux host Compose | `make docker-up` | Node filesystems/procfs, Docker, network, and systemd where available |
| Linux host Compose + NVIDIA | `make docker-gpu-up` | Host scope plus NVIDIA utility telemetry |
| Portable Compose | `make docker-sandbox-up` | App preview with isolated namespaces; no complete node claim |
| Native foreground | `make run` | Node metrics using the current service account |
| Native systemd | `make service-install` | Node metrics with a persistent user service |

Every mode uses a single sampler worker. Independent nodes need independent application instances and databases.

## Image and Compose

The multi-stage Dockerfile builds React with Node 24 and installs pinned Python dependencies in a separate stage. The runtime uses Python 3.12, a non-root account (UID/GID 12001), and Linux inventory tools. Source/build credentials and local history are excluded with `.dockerignore`.

Compose adds a read-only application filesystem, writable `/data` named volume, bounded temporary space, dropped capabilities, no-new-privileges, a 1 GiB memory ceiling, one CPU quota, a PID ceiling, restart policy, and log rotation. Stop with `make docker-down`; the named history volume is retained. Do not add `--volumes` unless you intend to delete history.

Compose 2.30+ supports the GPU override; the host override uses `!reset` to remove published ports before sharing the host network.

For local verification after building, run `make docker-test`. It creates a randomly named Compose project, checks unauthenticated rejection, non-root execution, retained history after restart, and actual host/Docker collection, then removes only that disposable project's containers and test volume. It leaves any regular OpsDeck deployment and its history untouched.

Equivalent explicit commands:

```bash
make init
export OPSDECK_DOCKER_GID=$(stat -c '%g' /var/run/docker.sock)
docker compose -f compose.yaml -f compose.host.yaml up -d --build --wait
# With NVIDIA:
docker compose -f compose.yaml -f compose.host.yaml -f compose.gpu.yaml up -d --build --wait
```

The host override mounts the node root read-only, shares its PID/network namespaces, and mounts its Docker socket. Linux kernel 5.12+ provides recursive read-only submount support; mounts created later may need container recreation to appear. Docker socket filesystem mode `ro` does **not** make the Docker API read-only. Socket access is a deliberate grant to a trusted monitoring application, even while UI actions are disabled. No service uses `privileged: true`.

On SELinux hosts, do not relabel the entire root filesystem with `:z` or `:Z`. Use native mode or an administrator-reviewed container policy.

### NVIDIA

Install/configure the host driver and NVIDIA Container Toolkit, verify the host's `nvidia-smi`, then use `make docker-gpu-up`. The override requests driver utility capability for NVML telemetry. GPU access is optional; a host without NVIDIA hardware can use normal host Compose.

### Direct Docker

For a portable preview:

```bash
make init docker-build
docker run --name opsdeck-preview --init --read-only \
  --cap-drop ALL --security-opt no-new-privileges \
  --env-file .env --env OPSDECK_BIND=0.0.0.0 --env OPSDECK_PORT=8080 \
  --env OPSDECK_DB=/data/opsdeck.sqlite \
  --mount type=volume,source=opsdeck-preview-data,target=/data \
  --tmpfs /tmp:rw,noexec,nosuid,size=64m \
  --memory 1g --cpus 1 --pids-limit 128 \
  --publish 127.0.0.1:8080:8080 opsdeck:local
```

To adapt full node monitoring, use the tested Compose host override rather than assembling host-access flags piecemeal.

## Private remote access

For host/native mode, set `OPSDECK_BIND` to the node's Tailscale address and restart. The host-mode health check follows that configured address. For portable mode, set `OPSDECK_PUBLISH_IP` to the desired private interface; the process still listens on all interfaces inside the container.

An SSH tunnel also works without changing the binding:

```bash
ssh -L 8080:127.0.0.1:8080 <user>@<node>
```

Use HTTPS termination before exposing the dashboard outside the private network. Public source visibility does not require publishing the dashboard or its token.

## Native services and offline nodes

```bash
make setup build service-install
make service-status
```

`install-user.sh` creates a user service. An administrator enables boot persistence with `loginctl enable-linger <service-user>`. Alternatively, adapt `deploy/opsdeck.service.example` for `/opt/opsdeck` and a dedicated account. Configure Docker socket membership deliberately; sensors and service status depend on that account's permissions.

For an offline Linux x86_64 / Python 3.12 node, build `make bundle` on a development machine, copy the archive, extract it, and run `bash deploy/install-user.sh`. The bundle includes frontend assets, docs, and wheels, and bootstraps pip without sudo or downloads. It does not include `.env` or databases.

## Clusters

The public HTTPS URL can be cloned without an account. Run the app on the node you want to inspect, subject to that cluster's administrator policy. A container scheduled on one node cannot describe every cluster node automatically.

For Kubernetes, use one replica per database, persistent writable storage, explicit secret injection, a probe on `/healthz`, and administrator-reviewed node mounts/PID/network access for host scope. Many managed clusters prohibit Docker sockets or host namespaces; in those environments Docker/systemd telemetry is unavailable and portable mode is not a replacement for cluster metrics. A fleet dashboard, Kubernetes API collector, and DaemonSet integration are not implemented.
