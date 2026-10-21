# User guide

## Sign in and freshness

Use the node's configured access token. The browser stores it for the current tab session; signing out clears it. A page refresh does not rotate the token.

The dashboard refreshes every 10 seconds. Individual collectors have their own schedules. **Unavailable** means a collector cannot retrieve its data; **not configured** means setup or hardware is missing; **stale** means the previous response has exceeded its freshness threshold. A failed browser refresh leaves the previous snapshot visible and shows a connection error.

A dash is an unavailable measurement, not zero. Check integration coverage before interpreting a quiet dashboard.

## Theme and status colors

Use the switch in the top bar to follow the system theme or pin light or dark mode. The choice is remembered in this browser.

Colors carry one meaning on every page: green is healthy or passed, amber is stale, pending, or needs a check, red is failed, unavailable, or critical, blue is guidance, and grey has no data or is not configured. Usage bars keep their series color until they cross a threshold (75% amber, 90% red; storage uses the 85% and 95% alert thresholds, pressure stalls 10% and 25%).

## Overview

The resource strip shows CPU use, memory use, the first GPU's utilization, and currently running CI containers identified on the host. **Capacity over time** supports hour, day, week, and month views. Charts show bucket averages; the history API also retains peak values.

**Needs attention** summarizes active thresholds and unavailable telemetry. **Integration coverage** opens Connections. **Storage headroom** shows mounted filesystem capacity; **Export snapshot** downloads a JSON snapshot without server integration credentials.

**Where to start** directs support staff to critical conditions, memory/storage contention, connection checks, or the affected workload. It uses existing thresholds and collector freshness; a quiet dashboard does not establish health for an unavailable source.

**Resource diagnostics**, on Overview and Host & hardware, shows CPU, memory and storage-wait averages, retained peaks, measurement counts and the latest point time. Averages use retained bucket means; peaks use the API's retained maxima. The history selector on Overview applies to these plots. The storage-pressure chart includes the 10% alert guide. **Filesystem risk ranking** orders mounts by the higher of byte or inode usage and reports free bytes. Last known readings are marked when the host source is stale or unavailable.

**Network throughput** shows receive/send bytes per second, excluding the collector's Docker, veth, bridge and Tailscale prefixes. **CI queue over time** shows bucket means of pending jobs across configured GitLab projects. These historical plots describe the whole node, independently of workload scope. Missing samples remain gaps.

## Browsing lists

Record lists have independent pagination, result ranges and Previous/Next controls. Host inventories, services, processes, interfaces, sensors, runner facts and metrics, survey evidence, alerts, recommendations and connections now paginate alongside the existing container, image, workload, checkpoint and audit lists. New list controls offer 5, 10, 20 or 50 records per page. Changing page size returns to page one; changing a list's filters resets its position. Live updates clamp the page when records disappear. Counts and diagnostic calculations cover the full loaded sample, not just the visible page.

Pagination applies to the records already collected. It does not remove upstream collection limits (for example, the top 15 host processes, newest 100 audit events, bounded image inventory or retained workload window). Selectors and fixed metric summaries remain visible together.

## Project and pipeline scope

The scope bar appears on Overview, Docker, Runner stack, Projects & pipelines, and Survey & benchmarks; it is tinted while a filter is active. Use the repository, pipeline, image and evidence-window selectors to switch from global workload views to selected evidence. **Projects & pipelines** provides server pagination and project/image usage. **Survey & benchmarks** can capture and compare live checkpoints; its imported report remains historical. See [Live surveys](../operations/live-surveys.md). Node hardware readings and shared runner limits remain global.

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

**Pipeline diagnostics**, on Projects & pipelines and Runner stack, uses the selected scope within the GitLab collector sample. It shows outcome counts (including other/unknown states), success among success/failed pipelines, nearest-rank p95 execution for measured successful pipelines, and p95 job queue wait. Missing and negative timings are excluded; zero is a real measurement. Small samples can make p95 equal the maximum. The paginated job chart ranks measured execution durations and shows queue wait separately, with full job names and values below. Running jobs may have partial durations. Retained workloads outside the current GitLab collector sample remain in the workload table, but are not included in these diagnostics. Stale GitLab results carry a notice.

## Optimization

Each item has evidence and a proposed next step. **Opportunity** identifies a condition in the latest available data. **Verify** needs workload or configuration checks. These labels do not claim that tuning has been applied.

Use the [operations workflow](../operations/maintenance.md#runner-optimization) to compare baseline and changed workloads. The web UI does not format devices. Scheduling settings can be changed through the separately enabled operator controls.

## Operations

Review and apply shared worker limits and optional per-registration scheduling limits. Load a saved image archive from your computer/USB, build from an uploaded context or configured node checkout, and add a local image tag. Images stay in the monitored node's Docker store. See [Operator actions](../operations/operator-actions.md) for enablement, supported archive formats, build profiles, progress and recovery.

Docker, workers, history, images, operation results and audit events have search/filter controls and pagination. Reset controls restore each table's defaults. Summary counters remain totals for the sampled node.

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

## Fleet command center

Central mode opens on **Runner fleet**: every enrolled host in one place. Setup is in [Central server and runner agents](../operations/fleet.md).

**First run.** With no hosts enrolled, the page lists the three steps: enroll the host, save its credential in a private `.env.agent` in the OpsDeck checkout on that host (`chmod 600 .env.agent`), then run `make agent-install`. Check the service with `make agent-status`.

**Summary.** The bar under the title splits hosts by state: online, stale, offline, waiting, maintenance and revoked. Hosts in maintenance count under maintenance, not their connection state. The readouts show hosts online out of the total, average CPU, memory and GPU across online hosts, CI jobs running, and open alerts by severity. With a cluster selected, every figure covers only that cluster.

**Fleet pulse.** Each row is a host and each cell is one time bucket, shaded from idle to saturated: under 20%, 20 to 40%, 40 to 60%, 60 to 80%, 80 to 90%, and 90% and above. The top two steps match the warning and critical thresholds. Pale cells have no samples; they do not mean zero. Switch the metric between CPU, memory and GPU, and the window between 1, 6 and 24 hours (60 buckets each). The right column is the current reading. Hover a cell for its host, time range and value. With the keyboard, Tab to a row, use Left/Right (or Home/End) to read cells, Up/Down to change rows, and Enter to open the host. Rows follow the host search, filters and sort order.

**Needs attention.** Open alerts, critical first:

| Condition | Warning | Critical |
|---|---|---|
| Agent contact | Telemetry stale | Agent offline |
| CPU or memory | At least 80% | At least 90% |
| I/O pressure (last-minute average) | At least 10% | At least 25% |
| Collector | Degraded or unavailable | Not used |

Waiting, revoked and maintenance hosts raise no alerts. Offline and stale hosts report the delivery problem rather than their last load. Select an alert to open its host. The list follows the cluster and search filters.

**Fleet capacity.** Average CPU and memory across reporting hosts, with dashed lines for the busiest host in each bucket, and CI jobs running in a separate chart below. Choose 1 hour, 6 hours, 24 hours or 7 days. A cluster selection narrows the chart to that cluster.

**Hosts.** Switch between **Grid** (cards with CPU, memory and GPU bars, a trend line for the pulse metric, CI jobs, last contact and notes) and **Table** (select a column heading to sort; select it again to reverse). The layout and **Group by cluster** choices are remembered in this browser. Search matches host name, hostname, cluster and notes. Status chips filter by state and show counts. **Export CSV** downloads the hosts currently shown with their latest metrics.

**Live updates.** Host states refresh every 10 seconds, the pulse every 30 seconds and capacity history every minute. The indicator in the top bar shows the age of the last successful update. Use its pause button to freeze the page; the choice lasts for this browser tab. Updates stop while the tab is hidden and resume immediately when it is visible again. After a failed request, OpsDeck keeps the last values on screen and retries after 10, 20, 40 and then every 60 seconds.

**Keyboard.** Press Ctrl K (Cmd K on macOS) or `/` to open the command palette, or select **Search or jump to** in the top bar. It opens hosts, clusters, Enroll host, Fleet audit and, with a host selected, each workspace page for that host; it also switches the host layout, pauses updates, exports CSV and signs out. Press `R` to refresh now and `?` to list shortcuts. Esc closes the palette and dialogs.

**Host settings.** On a host's detail page (opened from the fleet, or through **Agent access** in a connected host workspace), **Host settings** changes the name, cluster and notes (up to 500 characters). **Maintenance mode** suppresses the host's alerts and marks it as maintenance; telemetry is still recorded. Each change is recorded in **Fleet audit**. The **Agent access** panel below is the danger zone: type the host name, then **Rotate credential** (shows a new credential once and disconnects the running agent) or **Revoke agent** (stops telemetry; retained observations stay available).

**Fleet audit.** Lists enrollment, credential, settings and maintenance changes. Search runs on the server across titles and details. Filter by kind and severity, show the newest 100, 500 or 1000 events, and export the shown rows as CSV. Times show as relative age with the exact local time below.
