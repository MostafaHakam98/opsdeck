# OpsDeck handbook

Start with [Getting started](guides/getting-started.md), then use the guides below for the deployment you choose.

| Guide | What you will learn |
|---|---|
| [Getting started](guides/getting-started.md) | Anonymous clone, setup, first launch, and daily commands |
| [User guide](guides/user-guide.md) | Read each page, understand charts, investigate alerts, and use actions |
| [Operator walkthrough](guides/operator-walkthrough.md) | Step-by-step navigation, loading/recovery states, and a repeatable slowdown investigation |
| [Node access](guides/node-access.md) | Open a running deployment, retrieve its token, tunnel over SSH, and find the speedup report |
| [Configuration](guides/configuration.md) | Every environment setting, integration setup, and collection scope |
| [Deployment](operations/deployment.md) | Docker, Compose, NVIDIA, native services, offline installation, and cluster considerations |
| [Fleet deployment](operations/fleet.md) | Central AWS dashboard and outbound runner agents across networks |
| [Adding machines and runners](operations/adding-machines.md) | Install separate host workspaces and agents, connect runner telemetry, and verify enrollment |
| [Operations](operations/maintenance.md) | Health, logs, backup/restore, updates, retention, and optimization workflow |
| [Architecture](architecture/overview.md) | Data flow, access boundaries, API routes, and current limits |
| [Troubleshooting](guides/troubleshooting.md) | Diagnose missing metrics, startup failures, port conflicts, and database issues |
| [Runner surveys](operations/surveys.md) | Retain private pipeline benchmarks and optimization evidence without a GitLab connection |
| [Runner telemetry](operations/runner-telemetry.md) | Enable local runner metrics, inspect limits, and distinguish active workers from retained containers |
| [Live surveys and project dashboards](operations/live-surveys.md) | Global/project/pipeline/image scopes, optional GitLab results, retained checkpoints and comparisons |
| [Operator actions](operations/operator-actions.md) | Change worker limits, load USB/image archives, build and tag local images, and filter inventories |

Standalone mode monitors one node per application instance. Central mode aggregates enrolled host agents across networks. Cluster-wide Kubernetes API collection is separate and is not implemented.

For contributors, start with [Repository layout](architecture/repository-layout.md) and [Architecture](architecture/overview.md).
