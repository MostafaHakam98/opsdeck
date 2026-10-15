# Runner telemetry without a GitLab connection

The **Runner stack** page separates native service health, the runner metrics endpoint, and Docker activity. An active runner can have metrics disabled. Zero running CI containers means Docker currently sees no running build/helper containers; retained exited containers do not establish whether a job passed.

On a Linux node using the `gitlab-runner` system service and `/etc/gitlab-runner/config.toml`, run from the OpsDeck checkout:

```bash
cd ~/opsdeck
sudo bash scripts/runner/tune-runner-host.sh metrics
```

This metrics-only phase:

1. Validates the existing TOML and preserves every setting except the top-level `listen_address`.
2. Creates a private configuration backup and sets `listen_address = "127.0.0.1:9252"`. Existing custom addresses require manual review instead of being overwritten.
3. Exports only allowlisted configuration facts to `data/runner-facts.json`; no registration tokens are exported.
4. Sends SIGQUIT only to the service's main process, allowing existing jobs to finish before starting the service again. It waits up to one hour without forcing jobs to stop. If metrics are already available, it skips the drain.
5. Checks that the loopback endpoint returns runner metrics. It does not change concurrency, job limits, CPU/RAM quotas, disks, or Docker state.

If the service is already inactive, the command configures metrics but leaves it inactive. Complete any ongoing maintenance before starting it. If draining exceeds one hour, let jobs finish, inspect `systemctl status gitlab-runner`, then use `sudo systemctl start gitlab-runner` if necessary. Avoid a plain restart while jobs are running.

The loopback listener requires native OpsDeck or Docker host networking. Portable containers cannot reach the node through their own localhost. Use `RUNNER_METRICS_URL` for a separately configured endpoint. The default is `http://127.0.0.1:9252/metrics`.

For Docker installations, the optional `deploy/docker/compose.services.yaml` override mounts the host's `data/` directory read-only and reads facts from `/host-services/runner-facts.json`. Recreate OpsDeck with the same host/GPU/service overrides used for deployment. Native installations default to `data/runner-facts.json`. The facts are a dated export; run the metrics command again after changing runner configuration.

Refresh OpsDeck after 15 seconds. **Metrics endpoint** should read **Available**; the live global job limit and collected metrics will appear even with GitLab integration disabled. The worker table defaults to **Running containers**; select **All retained containers** for old containers. CPU/RAM are sampled only for running containers.

GitLab documents the [metrics listener](https://docs.gitlab.com/runner/monitoring/) and [SIGQUIT graceful shutdown](https://docs.gitlab.com/runner/commands/#signals). Collected metric names are summed across labels; histogram bucket totals are not duration percentiles or queue-time estimates.
