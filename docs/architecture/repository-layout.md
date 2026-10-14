# Repository layout

Keep application code, deployment assets, administrative tools, and private runtime state in separate directories. Run Make commands from the repository root.

```text
opsdeck/
├── backend/                    # FastAPI runtime and collectors (Python package)
├── frontend/
│   ├── src/
│   │   ├── app/                # Browser entry point and application styling
│   │   ├── features/runners/   # Runner inventory and survey views
│   │   └── lib/                # API client, formatters, and their unit tests
│   └── e2e/                    # Browser tests
├── deploy/
│   ├── docker/                 # Dockerfile and Compose deployment modes
│   ├── native/                 # Native systemd installer and unit example
│   ├── offline/                # Offline distribution builder
│   └── *.py                    # Initialization, backup, import, export, smoke tools
├── scripts/runner/             # Administrator runner configuration and host tuning
├── tests/
│   ├── backend/                # API, configuration, collectors, retained evidence
│   └── operations/             # Deployment helpers, docs, exports, runner tooling
├── docs/
│   ├── guides/                 # Setup, usage, configuration, troubleshooting
│   ├── operations/             # Deployment, maintenance, private surveys
│   └── architecture/           # Runtime design and this repository map
├── .github/workflows/          # Build and verification automation
├── Makefile                    # Stable command interface
├── README.md                   # Project entry point
├── .env.example                # Public configuration template
├── data/                       # Ignored native database and private findings
├── .tmp/                       # Ignored scratch files, backups, screenshots
└── dist/                       # Ignored distribution archives
```

## Boundaries

- `backend` contains the long-running application. Keep operator-only runner mutations in `scripts/runner`, separate from collectors and browser actions.
- `frontend/src/app` owns application wiring. Runner-specific presentation belongs in `features/runners`; reusable client helpers belong in `lib`.
- Python deployment modules keep their existing `deploy.*` entry points, including `deploy.export_services`, so scheduled service exporters continue working after source updates.
- Tests mirror application and operational responsibilities. Frontend unit tests remain next to their helpers; browser tests live in `frontend/e2e`.
- Credentials, survey evidence, databases, generated builds, and scratch work stay in ignored runtime directories. Docker builds exclude them.

## Command paths

Use `make docker-build`, `make docker-up`, `make service-install`, and `make bundle` to avoid depending on file locations. Direct Compose commands must specify the root project directory:

```bash
docker compose --project-directory . -f deploy/docker/compose.yaml ps
make docker-gpu-up COMPOSE_EXTRA=deploy/docker/compose.services.yaml
sudo python3 scripts/runner/admin.py --export-only --facts ./data/runner-facts.json
```

Keeping `--project-directory .` preserves root `.env` loading, build context, bind paths, and the existing Compose project/volume names after moving the YAML files. Run these examples from the repository root.

Native installation uses `deploy/native/install-user.sh`; offline builds use `deploy/offline/build-bundle.sh`. Both scripts locate the repository root relative to their own location. Offline archives preserve this hierarchy and use a fresh staging directory for every build.
