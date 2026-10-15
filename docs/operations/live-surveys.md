# Global/project dashboards and live survey checkpoints

OpsDeck observes the runner host continuously. The original imported optimization report covers **geodrive-base**; it is historical benchmark evidence, not a survey of every repository. New live views cover retained observations across repositories on this Docker node and, optionally, configured GitLab projects.

## Choose a dashboard scope

The scope bar appears throughout the workspace:

- **Repository:** all known repositories or one project. Names come from allowlisted CI metadata or GitLab; a numeric project label is used until a namespace/path is known.
- **Pipeline:** all identified pipelines or a particular project/pipeline pair.
- **Image:** all images or a selected Docker image ID / unresolved historical reference.
- **Evidence window:** observations retained during the last day/week/month, or all retained observations. This is an observation window, not a pipeline creation-date filter.

Overview's workload summary, Docker/runner inventories, live checkpoints, and the project explorer follow this scope. Hardware charts, disk capacity and shared runner limits remain node-wide. Summary counts describe the selected evidence before additional table search/status filters. Reset scope returns to all repositories and a 24-hour window.

**Projects & pipelines** provides server-paginated tables for repositories, pipelines, images by repository, and observed job containers. Select a repository, pipeline or image in the table to drill into that scope. Table search, pipeline outcome filters and paging work independently of the global scope. The backend bounds loaded worker/pipeline evidence to 10,000 records and reports truncation; live Docker inventory remains bounded to 200 containers / 500 images. Scope selectors list up to 500 recent identified pipelines.

## What each source establishes

| Evidence | What OpsDeck can establish | What remains unknown |
|---|---|---|
| Runner/Docker | Observed containers, project/job/pipeline identifiers when exposed, exact image IDs, state, CPU/RAM samples | Whether the full pipeline passed; queue and canonical pipeline duration |
| Read-only GitLab API | Pipeline status, duration/queue where supplied, project names and selected job metadata | Whether every job ran on this particular machine; images for jobs that were never observed locally |
| Imported benchmark | The report's recorded outcomes, timings and optimization evidence | Current behavior in other repositories |
| Manual checkpoint | A dated snapshot of selected evidence, source freshness and node resources | A causal optimization gain or an automatic repeatable workload benchmark |

A Docker container exit or removal never becomes an inferred successful pipeline. **Observed running** is a runner observation; **GitLab-confirmed status** is retained API evidence, with its confirmation timestamp. Failed/disconnected integrations do not erase previously confirmed results. Treat the timestamp as the time evidence was read, not a promise that an old running status is current.

## Observe image usage by project

Image/repository associations come from sampled CI containers. Shared images can belong to multiple project usage records. Tag spelling does not establish repository ownership. Exact image IDs are retained for new observations; old tag-only records are marked historical/unresolved instead of assuming the current tag points to the old image.

Only named public CI identifiers are retained from CI container environments: project ID/path, job ID/name, pipeline ID, ref and runner ID. Raw Docker environments, job tokens and other variables are not retained. Inspection is bounded to 16 previously unseen CI containers per poll and cached while containers remain visible. Sampling may miss short-lived containers.

## Connect optional read-only GitLab

Open **Connections → GitLab pipeline results**:

1. Enter the HTTPS GitLab base URL.
2. Enter a dedicated token with `read_api` access. Use only the projects the operator should be able to inspect.
3. Keep automatic inclusion of observed runner project IDs enabled, and optionally add explicit project IDs or namespace/project paths.
4. Save and validate the connection.

The server validates the token with a GET request, stores it privately in `OPSDECK_GITLAB_CONNECTION_FILE` (native `data/gitlab-connection.json`; Compose `/data/gitlab-connection.json`, mode 600), and starts a poll. Saved credentials never return to the browser, snapshots, exports or checkpoints. Empty token input keeps the existing credential only when the URL remains the same. Disabling polling clears that saved connection while retaining previously collected evidence.

Up to 32 configured/observed projects are read per poll. Recent pipelines plus bounded running/pending pipelines and selected job records are retained. No GitLab project setting, variable, repository, pipeline or job is modified. Polling repeats every 60 seconds; other collectors continue independently.

For older records, choose a repository in **Projects & pipelines** and use **Read GitLab history page N**. Each action reads ten pipelines with their available timing details and retains the results in SQLite; the button stops at the end of available history. Choose **All retained observations** to include old records read now. Previously unseen image usage cannot be reconstructed from status alone. The first imported history is not a complete historical backfill of the GitLab instance.

Environment-based `GITLAB_URL`, `GITLAB_TOKEN` and `GITLAB_PROJECT_IDS` remain supported when no private connection file exists. The UI's saved configuration takes precedence. The dashboard access token authorizes connection configuration; there is no separate account/RBAC system.

## Capture and compare checkpoints

In **Survey & benchmarks**, give the current scope a checkpoint name, add notes explaining the workload/change, and select **Save current checkpoint**. The checkpoint retains:

- Its repository/pipeline/image/window scope and capture time.
- Source statuses, source sampling timestamps and ages.
- Node CPU/RAM readings, Docker build-cache size and live shared job limit where available.
- Scoped observed containers/jobs, known/unknown pipeline results, and the population of successful pipelines with timing.
- Up to 100 pipeline detail rows, with explicit truncation if the selection is larger.

The last 200 manual checkpoints persist in the database. Filter history by text/current scope, paginate, or export a checkpoint as JSON. Later live samples never alter saved checkpoint values. The original imported report remains below the live checkpoint tools and follows repository scope; its historical pipeline comparison remains separate.

Choose two saved checkpoints with the same scope to compare resource readings and pipeline evidence. The server refuses a comparison with a different repository, pipeline, image or evidence window. Median successful-pipeline duration is a population statistic over the observed window; workload changes, cache state and queue behavior can affect it. It does not automatically establish the speedup caused by a tuning action. Use a controlled repeated workload for that claim.
