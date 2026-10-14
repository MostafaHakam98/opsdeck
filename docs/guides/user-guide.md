# User guide

## Sign in and freshness

Use the node's configured access token. The browser stores it for the current tab session; signing out clears it. A page refresh does not rotate the token.

The dashboard refreshes every 10 seconds. Individual collectors have their own schedules. **Unavailable** means a collector cannot retrieve its data; **not configured** means setup or hardware is missing; **stale** means the previous response has exceeded its freshness threshold. A failed browser refresh leaves the previous snapshot visible and shows a connection error.

A dash is an unavailable measurement, not zero. Check integration coverage before interpreting a quiet dashboard.

## Overview

The resource strip shows CPU use, memory use, the first GPU's utilization, and currently running CI containers identified on the host. **Capacity over time** supports hour, day, week, and month views. Charts show bucket averages; the history API also retains peak values.

**Needs attention** summarizes active thresholds and unavailable telemetry. **Integration coverage** opens Connections. **Storage headroom** shows mounted filesystem capacity; **Export snapshot** downloads a JSON snapshot without server integration credentials.

## Host & hardware

- **Host facts:** node name, collection scope, operating system, uptime, load, CPU frequency, process count, swap, and page cache.
- **Pressure stalls:** percentage of time tasks waited for CPU, memory, or I/O over the last minute. CPU utilization alone cannot reveal an I/O bottleneck.
- **Filesystem capacity:** used bytes, free bytes, and inode use per mount.
- **Device inventory:** physical disks and reported filesystems/partitions. No filesystem reported does not mean a device is unowned or safe to format.
- **Physical disks & I/O:** read/write rates, IOPS, average read/write latency, and busy time. An idle interval has no measured latency; NVMe busy time is not a complete saturation measure.
- **Network interfaces:** physical and Tailscale interfaces by default. Use **Show virtual interfaces** to inspect container bridges and veth devices.
- **GPU & temperatures:** each detected NVIDIA device, memory, temperature, driver, and power. Sensor availability depends on the host and permissions.
- **System services:** configured systemd units and exit status. A healthy service collector can still report a failed service.
- **Processes:** top 15 by resident memory. CPU percentages require two observations. Arguments and process environments are not collected.

## Docker

Search containers by name/image and filter by state. Inspect state, Docker health status, CPU, resident memory, and ownership. Multi-core container CPU can exceed 100%. A memory limit may reflect the host total if no container ceiling is configured.

Image-layer and build-cache measurements come from Docker's disk usage API and are cached for five minutes. A first CPU sample remains empty. The UI does not prune caches or images automatically.

## Runner stack

This page reads live CI containers, local image tags and revisions, image sizes, container references, Docker cache volumes, and their backing paths directly from the node. Search the catalog by tag or toolchain profile. Image aliases share layers; summing displayed image sizes double-counts storage. CI roles and job IDs are shown when Docker labels provide them. Missing labels stay explicit.

## Survey & benchmarks

Imported private surveys retain measured pipeline outcomes, timing comparisons, job details, changes and follow-ups, and the complete original report with its hash. Current host checks appear independently of recorded statuses. See [Runner surveys](../operations/surveys.md) for import and persistence instructions. No GitLab token is required for these views.

## Optional GitLab timing view

Recent and active pipelines show branch, status, duration, and queued duration when the GitLab version supplies those fields. Jobs include their execution duration, queue duration, and assigned runner. Search job names/projects or filter pending, running, failed, and successful jobs.

Counts cover the configured project sample; they are not instance-wide fleet counts. Runner facts show worker limits, request concurrency, and configured CPU/RAM budgets when exported by an administrator. Expand runner measurements for numeric Prometheus series; cumulative counters are not rates.

## Optimization

Each item has evidence and a proposed next step. **Opportunity** identifies a condition in the latest available data. **Verify** needs workload or configuration checks. These labels do not claim that tuning has been applied.

Use the [operations workflow](../operations/maintenance.md#runner-optimization) to compare baseline and changed workloads. The web UI does not format devices or edit runner settings.

## Activity & audit

Threshold transitions and attempted action executions appear in the newest 100 events. Metric and threshold-event retention defaults to 30 days. Action audit records survive that retention setting.

| Condition | Warning | Critical |
|---|---|---|
| Filesystem capacity | At least 85% used | At least 95% used |
| Inodes | At least 85% used | — |
| Memory | — | At least 90% used |
| I/O pressure | Last-minute `some` average above 10% | — |
| GPU temperature | Above 85 °C | — |
| Docker health | — | Container reports unhealthy |
| Monitored service | Inactive loaded unit | Failed loaded unit |
| Collector | Unavailable | — |
| Sampled CI queue | At least one pending job | — |

Thresholds are currently built into the backend. Alert delivery to email/chat and custom threshold editing are not implemented.

## Container actions

Actions default to disabled. An administrator must set `OPSDECK_ACTIONS=true`, then opt eligible containers in with `opsdeck.managed=true`.

1. Open Docker and select **Restart** or **Stop** on the intended managed container.
2. Read the preview's exact target and interruption impact.
3. Type the displayed confirmation text within 60 seconds.
4. Confirm the action, then verify state in the next live sample.

The backend rechecks the container and consumes the nonce once. GitLab job containers and the OpsDeck container are excluded. A Docker timeout may occur after the daemon receives the request; inspect the current state before retrying. The Activity page retains request/result records.
