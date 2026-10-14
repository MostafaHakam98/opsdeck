# OpsDeck handbook

Start with [Getting started](getting-started.md), then use the guides below for the deployment you choose.

| Guide | What you will learn |
|---|---|
| [Getting started](getting-started.md) | Anonymous clone, setup, first launch, and daily commands |
| [User guide](user-guide.md) | Read each page, understand charts, investigate alerts, and use actions |
| [Configuration](configuration.md) | Every environment setting, integration setup, and collection scope |
| [Deployment](deployment.md) | Docker, Compose, NVIDIA, native services, offline installation, and cluster considerations |
| [Operations](operations.md) | Health, logs, backup/restore, updates, retention, and optimization workflow |
| [Architecture](architecture.md) | Data flow, access boundaries, API routes, and current limits |
| [Troubleshooting](troubleshooting.md) | Diagnose missing metrics, startup failures, port conflicts, and database issues |

OpsDeck monitors one node per application instance. It does not aggregate an entire Kubernetes or HPC cluster into one dashboard.
