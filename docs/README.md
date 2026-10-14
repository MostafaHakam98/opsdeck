# OpsDeck handbook

Start with [Getting started](guides/getting-started.md), then use the guides below for the deployment you choose.

| Guide | What you will learn |
|---|---|
| [Getting started](guides/getting-started.md) | Anonymous clone, setup, first launch, and daily commands |
| [User guide](guides/user-guide.md) | Read each page, understand charts, investigate alerts, and use actions |
| [Configuration](guides/configuration.md) | Every environment setting, integration setup, and collection scope |
| [Deployment](operations/deployment.md) | Docker, Compose, NVIDIA, native services, offline installation, and cluster considerations |
| [Operations](operations/maintenance.md) | Health, logs, backup/restore, updates, retention, and optimization workflow |
| [Architecture](architecture/overview.md) | Data flow, access boundaries, API routes, and current limits |
| [Troubleshooting](guides/troubleshooting.md) | Diagnose missing metrics, startup failures, port conflicts, and database issues |
| [Runner surveys](operations/surveys.md) | Retain private pipeline benchmarks and optimization evidence without a GitLab connection |

OpsDeck monitors one node per application instance. It does not aggregate an entire Kubernetes or HPC cluster into one dashboard.

For contributors, start with [Repository layout](architecture/repository-layout.md) and [Architecture](architecture/overview.md).
