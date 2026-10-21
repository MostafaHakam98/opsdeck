# Architecture and access boundaries

## Central fleet mode

`OPSDECK_MODE=central` starts the fleet API without any local collectors or operator controls. `backend/fleet.py` owns node enrollment, credential hashes, bounded telemetry ingestion, latest snapshots, per-node numeric history, freshness, and access audit events. Agents run `python -m backend.agent` on each runner host, reuse the existing local collectors, and push snapshots over outbound HTTPS. The agent has no HTTP listener and uses a bounded durable retry queue.

Fleet samples are deduplicated by `(node_id, sample_id)`. Enrollment metadata and cluster assignment come from the operator; an agent credential is bound to its enrolled identity. Backfilled observations populate history without replacing a newer snapshot. Fleet and standalone tables coexist, but their histories are not implicitly mixed. Fleet overview reads compact summaries; detailed inventory is loaded for a selected host only. See [Fleet deployment](../operations/fleet.md).

The optional workspace relay in `backend/workspace.py` and `backend/workspace_agent.py` lets the same host UI reach its existing standalone API. The agent claims allowlisted requests over outbound HTTPS, uses a separate host credential locally, and streams replies back. The central process has no host mounts or local controls. Existing checkpoints, findings, GitLab connections, previews, and operations remain owned by the standalone host service. The UI scopes every nested request through `HostApiProvider`; switching hosts remounts the workspace to clear previous host state.

## Standalone mode

```mermaid
flowchart LR
  B[React browser] -->|Bearer token / same-origin API| API[FastAPI / one worker]
  API --> S[Cached snapshots]
  H[Linux host collector] --> S
  D[Docker collector] --> S
  G[GPU / runner / GitLab / services] --> S
  S --> R[History sampler / alert transitions]
  R --> DB[(SQLite WAL)]
  API -->|Allowlisted preview / one-use confirmation| A[Action service]
  A -->|Intent and result| DB
  A -->|Opted-in non-CI container| DE[Docker API]
  API --> O[Reviewed operator controls]
  O -->|Serialized image build / load / tag| DE
  O -->|Persistent tasks and audit| DB
  O -->|Group-restricted Unix socket| RC[Root-owned capacity helper]
  RC -->|Validated scheduling fields only| TOML[Runner configuration]
```

Collectors poll independently in background tasks, with blocking reads in worker threads. API reads return cached snapshots; opening more dashboards does not spawn more collectors. Slow GitLab requests cannot block host polling.

## Repository map

| Path | Responsibility |
|---|---|
| `backend/main.py` | API, authentication, collector scheduling, history and alert events |
| `backend/collectors.py` | Host, Docker, GPU, GitLab, runner, and systemd reads |
| `backend/findings.py` | Validated private survey archives and independent current checks |
| `backend/config.py`, `backend/run.py` | Environment settings and one-worker launcher |
| `backend/store.py` | SQLite samples, averaged history buckets, audit events |
| `backend/workspace.py`, `backend/workspace_agent.py` | Bounded per-host outbound workspace API relay |
| `backend/actions.py` | Ownership validation, previews, expiry, replay protection, execution |
| `backend/workloads.py`, `backend/gitlab_connection.py` | Retained workload attribution, scoped checkpoints, and private read-only GitLab setup |
| `backend/operations.py` | Runner-control client, bounded uploads, operation previews and serialized local image tasks |
| `frontend/src/app/` | Dashboard entry point, page wiring, and application styles |
| `frontend/src/features/runners/`, `frontend/src/lib/` | Runner/survey views, API client, formatting helpers |
| `deploy/` | Stable Python initialization, backup, import/export, and verification commands |
| `deploy/native/`, `deploy/offline/` | Native service assets and offline distribution builder |
| `scripts/runner/` | Administrator runner configuration and host tuning |
| `tests/backend/`, `tests/operations/` | Runtime checks and operational/deployment checks |
| `docs/` | User and operator handbook |
| `.tmp/` | Ignored local screenshots, browser artifacts, and backups |
| `deploy/docker/` | Runtime Dockerfile and explicit Compose deployment modes |

See [Repository layout](repository-layout.md) for the directory hierarchy and command-path conventions.

## HTTP surface

| Method / route | Authentication | Purpose |
|---|---|---|
| `GET /healthz` | None | Minimal liveness |
| `GET /api/snapshot` | Bearer | Sources, freshness, alerts, recommendations |
| `GET /api/history?hours=1` | Bearer | At most 600 averaged buckets, with peaks |
| `GET /api/events` | Bearer | Newest 100 events |
| `GET /api/metrics` | Bearer | Prometheus gauges |
| `POST /api/actions/preview` | Bearer | Validated 60-second action plan |
| `POST /api/actions/execute` | Bearer | One-use confirmed stop/restart |
| `GET /api/operations/capabilities` | Bearer | Operator enablement, capacity helper state, build profiles, completed uploads |
| `GET /api/operations/jobs` | Bearer | Latest 50 persistent image operation results |
| `POST /api/operations/preview` | Bearer | Reviewed capacity or local-image operation |
| `POST /api/operations/execute` | Bearer | One-use execution; image work is queued |
| `POST /api/operations/uploads?kind=image&name=file.tar` | Bearer | Bounded streaming archive upload; kind can also be context |
| `POST /api/operations/uploads/{id}/discard` | Bearer | Remove an unused staged upload |

The browser and API share an origin in production. Responses include content security, no-frame, no-sniff, and referrer headers; API responses are not cached. Authentication failures are rate limited. The application uses one operator credential, not individual identities or RBAC.

## Permissions

GitLab is read-only. Credentials stay in server configuration and are removed from exported integration error messages. Runner facts pass an allowlist before exposure. Process arguments/environments, raw Docker environments, and raw container logs are not retained. Only allowlisted public CI identifiers are retained for job/project/pipeline attribution.

Actions require the managed label and current container identity. Runner-named containers, GitLab-labeled jobs, and OpsDeck itself are excluded. These checks protect against operator mistakes; users who already control the Docker socket can alter labels and have extensive host control. A socket mount marked read-only still permits API requests.

Operator controls have a separate opt-in. Local image tasks revalidate source IDs/tags before execution, preserve existing local tags, and persist task results. The app never receives a write mount for runner TOML. The root-installed capacity helper accepts only scheduling fields over a restricted Unix socket; it checks configuration revisions, preserves other settings, and coordinates with host maintenance using a file lock. See [Operator actions](../operations/operator-actions.md).

Host Compose has explicit node access; portable Compose does not. The application reports its collection scope rather than presenting container-only filesystems as complete node data.

## Current limits

- Standalone: one node per instance and one sampler worker per database. Central: one server process with per-node agent ingestion and history. No distributed tracing.
- Host/history: default 10-second interval. Docker/GPU/runner/services: at least 15 seconds. Survey files: 30 seconds. Optional GitLab: 60 seconds.
- Docker inventory: 200 containers; stats: 64 running containers. Disk usage: five-minute cache.
- Processes: top 15 by resident memory. GPU history: first detected device; hardware view: every device.
- GitLab: at most 32 projects and bounded pipeline/job samples, as documented in configuration.
- Charts use averaged buckets. Missing values remain null; peaks are available in the history response.
- No centralized log search, alert delivery, SMART integration, cache hit-rate instrumentation, Kubernetes API collector, custom thresholds, or arbitrary command execution.

## Verification

Backend checks cover authentication, configuration loading, history retention, backup consistency, mount mapping, collector behavior, action ownership/expiry/replay, and safe runner edits. Frontend unit checks cover unavailable-value formatting. Browser checks cover navigation, responsive layouts, unavailable integrations, and typed action confirmation; the action UI test uses explicit test fixtures, while backend action tests exercise enforcement independently.

CI runs those checks plus a production build and container smoke verification. Runtime configuration and private data are excluded from image contexts and repository commits.
