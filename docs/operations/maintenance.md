# Operations

## Health and logs

`/healthz` checks process liveness and does not require a token. It does not assert that GitLab, Docker, or the GPU is available. Use **Connections** and `/api/snapshot` for collector health.

```bash
make health
make docker-status
make docker-logs
# Native service:
make service-status
make service-logs
```

The API exposes authenticated Prometheus gauges at `/api/metrics`. Configure your scraper's bearer token from a protected file, then scrape that path. The endpoint does not proxy the complete runner exporter; scrape the runner separately for its full label series.

## Backups

SQLite uses WAL. Copying only the active `.sqlite` file can miss committed WAL changes. The backup helper uses SQLite's online backup API, verifies integrity, and creates mode-600 files without overwriting existing backups.

Native mode:

```bash
make backup
# Alternate path:
make backup BACKUP_DB=/path/to/opsdeck.sqlite
```

Backups default to ignored `.tmp/backups/`. Copy them to an independent backup location; the local directory alone is not redundancy.

Compose:

```bash
make docker-backup
docker compose --project-directory . -f deploy/docker/compose.yaml exec opsdeck ls /data/backups
docker compose --project-directory . -f deploy/docker/compose.yaml cp opsdeck:/data/backups/<backup-name>.sqlite .tmp/backups/
```

Container backups live in the same persistent volume until copied off-node. Keep that extra copy independently.

## Restore

Stop the application before replacing its database. Keep the current database and any `-wal`/`-shm` siblings as a recovery set; stale journal siblings must not accompany a restored database.

For native mode, stop the foreground process or service, move the existing set into a timestamped recovery directory, copy the verified backup to the configured database path, confirm service-account ownership, then restart.

For Compose, stop the service with `docker compose --project-directory . -f deploy/docker/compose.yaml stop opsdeck`. Use a one-off container attached to the same named volume to move the existing database/journals into `/data/recovery/<stamp>/` and restore the selected backup. Keep actions disabled until verifying the restored history. Avoid starting a second sampler against the same SQLite file.

## Update and rollback

```bash
safe-git pull --ff-only
make docker-up
# Or preserve the GPU deployment mode:
make docker-gpu-up
```

Take a database backup before updating. Keep the same Compose project name and volume for persistence. Rebuilding/recreating containers preserves that volume. Switching host/portable/GPU modes can change integration coverage; verify collection scope afterward.

Native updates use `make setup build`, then restart the service. Roll back to a known tagged release or separate checkout and rebuild its image. No automatic deployment or image publishing is configured in CI.

## Retention and token rotation

Metrics and threshold events follow `OPSDECK_RETENTION_DAYS`; action records are retained. Monitor database/volume capacity. Restart after changing retention or integration credentials.

To rotate access, replace the token in the protected environment file with a fresh random value and restart the app. Existing browser sessions then fail authentication and must sign in again. `make init` does not rotate tokens.

## Runner optimization

1. Record warm/cold job latency, queue time, throughput, resource peaks, and storage pressure under a repeatable mixed workload.
2. Adjust one resource at a time. Start with storage placement and bounded compiler/test worker counts.
3. Benchmark 8, 12, and 16 slots; retain the configuration that improves throughput without unacceptable p95 latency or memory pressure.
4. Use bounded RAM scratch for selected disposable data; retain persistent caches on fast storage.
5. Coordinate exclusive GPU ownership before adding tests or inference services.

The administrator helper previews a single selected runner without exposing its token:

```bash
sudo python3 scripts/runner/admin.py --runner '<name>' --concurrent 8 --requests 4 --metrics
# Apply only the reviewed candidate:
sudo python3 scripts/runner/admin.py --runner '<name>' --concurrent 8 --requests 4 --metrics --apply
```

Existing per-runner job limits are preserved unless `--limit N` is specified. CPU and memory ceilings are optional measured budgets, not universal defaults. A new metrics listener may require a drained restart.

`scripts/runner/tune-runner-host.sh` targets the two named NVMe devices and `/var/lib/docker` plus `/cache`. Run its preflight and review ownership, actual workspace paths, storage driver, capacity, and downtime before explicit device confirmation. Formatting pauses all projects on that runner. Failed migrations leave services stopped for inspection.

The retained HDD directories are pre-migration snapshots, not current backups. Reverse-sync current data during a drained maintenance window before reverting if later data must be preserved. The script's rollback requires explicit acknowledgment of the older snapshot. See its comments and printed configuration backups before starting services.
