# Private runner surveys and pipeline benchmarks

For continuous project/pipeline observation and manual UI checkpoints, use [Live surveys and project dashboards](live-surveys.md). The imported optimization report discussed below is separate historical evidence.

OpsDeck can retain a runner survey without connecting to GitLab. Use this for the measured baseline, optimization rounds, job outcomes, cancellation notes, cold-cache caveats, and open follow-ups.

**Survey & benchmarks** shows recorded outcomes and timings. **Runner stack** shows live Docker workers, local image tags, toolchain availability, cache volumes, and their storage paths. The Overview strip counts identified running CI containers, including build/helper/service containers; this is not a GitLab queue count.

Open **Your runner speedup report** from Overview, or **Survey & benchmarks** in the navigation. Choose **Compare baseline** and **Compare result** to calculate execution speedup, runner work saved, queue wait, and job regressions. The queue-plus-execution total is derived and can reveal when waiting offsets execution gains. Download the selected comparison, job caveats, optimization evidence, and follow-ups with **Download speedup report**.

Optional `measurements` rows preserve additional experiments: `title`, `before`, `after`, `kind` (`measured` or `projection`), `evidence`, and `note`. Use measured ranges exactly as observed; label estimates as projections. Ratios are calculated only for known nonnegative timings, and a zero duration never creates an infinite speedup.

## Import an archive

Create a JSON file following `backend/findings.py`'s version-1 schema, then validate and import it:

```bash
.venv/bin/python -m deploy.import_findings /private/path/survey.json
```

Default destination is `data/findings.json`, excluded from Git. `OPSDECK_FINDINGS_PATH` selects another file. The native collector reloads it every 30 seconds. Archive fields include source date/hash/report, benchmark pipeline records and selected jobs, job timing comparisons, optimizations, expected image tags, context, and caveats. Each job comparison must have one column per measured benchmark; interrupted runs can have unknown aggregate times.

The importer rejects unsupported fields, invalid measurements, mismatched comparison columns, and archives larger than 2 MiB. It writes atomically with private file permissions. Source text is rendered as escaped text, not executable HTML or commands.

For Compose, install the validated archive into the service's persistent data volume using an operator-controlled import. Ensure it is readable by UID 12001 and remains private. Do not bake surveys or credentials into the image or commit them to the public repository.

```bash
make docker-import-survey SURVEY=/private/path/survey.json
```

This validates standard input and writes atomically as the service account with mode 600. It works with host/GPU deployments already running; no restart is needed.

## Evidence and present state

Original **done**, **prepared**, and **recommended** statuses remain intact. Independent current checks can verify NVMe backing for Docker/cache, presence of expected image tags, and CPU energy preference. Repository changes and exact runner limits need their own evidence; the dashboard does not infer them from an idle host.

Reported wall time, summed job time, and first-job queue wait are separate measurements. A critical-path estimate remains a projection. Unrecorded job timings remain empty; one-time captured job records are labeled with their capture timestamp and do not become live telemetry.

A deployment with GitLab settings left empty performs no authenticated GitLab API reads. The optional integration remains available for other installations, but is unnecessary for runner-host monitoring and archived findings.

## Persistence

Keep the archive in `/data` under Compose, alongside retained SQLite history, and preserve the named volume during restarts/recreation. Copy the archive separately with database backups. Docker's restart policy plus an enabled host Docker service starts the application again after reboot; an intentional operator stop remains respected.

Observed CI containers are also retained in SQLite: identity/image, first/last seen, current or disappeared state, and observed CPU/RAM peaks. Observations follow the configured retention period. Sampling can miss containers shorter than the polling interval, and disappearance never becomes an inferred successful pipeline result.
