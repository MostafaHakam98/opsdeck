import { useState, type ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Box, ClipboardList, Search, Server } from "lucide-react";
import { bytes, duration, safeUrl, type Source } from "../../lib/api";
import { SpeedupReport } from "./SpeedupReport";

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>{title}</h2>
        {note && <span>{note}</span>}
      </div>
      {children}
    </section>
  );
}
function Pill({ value }: { value: string }) {
  return (
    <span
      className={`badge ${["success", "done", "verified", "running"].includes(value) ? "good" : ["failed", "not_applied"].includes(value) ? "bad" : "muted"}`}
    >
      {value.replaceAll("_", " ")}
    </span>
  );
}
function Empty({ text }: { text: string }) {
  return (
    <div className="empty">
      <ClipboardList size={25} />
      <p>{text}</p>
    </div>
  );
}

export function SurveyPage({ source }: { source?: Source }) {
  const archive = source?.data;
  const [selected, setSelected] = useState<number | null>(null);
  if (!archive)
    return (
      <Section title="Survey archive">
        <Empty
          text={
            source?.message ||
            "Import a private survey archive to retain the measurements, outcomes, and optimization evidence."
          }
        />
      </Section>
    );
  const measured = archive.benchmarks.filter(
    (b: any) => b.runner_seconds != null,
  );
  const last = measured[measured.length - 1];
  const benchmarks = measured.map((b: any) => ({
    label: `#${b.pipeline_id}`,
    execution: b.wall_seconds == null ? null : b.wall_seconds / 60,
    queue: b.queue_seconds == null ? null : b.queue_seconds / 60,
  }));
  const selectedIndex =
    selected ?? Math.max(0, archive.benchmarks.indexOf(last));
  const pipeline =
    archive.benchmarks[Math.min(selectedIndex, archive.benchmarks.length - 1)];
  return (
    <>
      <div className="optimization-intro">
        <ClipboardList size={25} />
        <div>
          <h2>{archive.title}</h2>
          <p>
            Recorded {archive.recorded_on}. Measurements and statuses below are
            retained evidence, not live pipeline telemetry. Current checks are
            shown separately.
          </p>
        </div>
      </div>
      <SpeedupReport archive={archive} />
      {Object.keys(archive.context || {}).length > 0 && (
        <Section title="Survey context">
          <dl className="facts">
            {Object.entries(archive.context).map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>{String(value)}</dd>
              </div>
            ))}
          </dl>
        </Section>
      )}
      <Section title="Benchmark pipelines" note={archive.source_name}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Pipeline</th>
                <th>Outcome</th>
                <th>Passed jobs</th>
                <th>Sum of job time</th>
                <th>Observed wall time</th>
                <th>First-job wait</th>
                <th>Evidence</th>
              </tr>
            </thead>
            <tbody>
              {archive.benchmarks.map((b: any, i: number) => (
                <tr key={b.pipeline_id}>
                  <td>
                    <button
                      className="text-button"
                      onClick={() => setSelected(i)}
                    >
                      #{b.pipeline_id}
                    </button>
                    <small>{b.label}</small>
                  </td>
                  <td>
                    <Pill value={b.status} />
                  </td>
                  <td>
                    {b.passed_jobs == null
                      ? "—"
                      : `${b.passed_jobs}/${b.total_jobs}`}
                  </td>
                  <td>{duration(b.runner_seconds)}</td>
                  <td>{duration(b.wall_seconds)}</td>
                  <td>{duration(b.queue_seconds)}</td>
                  <td>
                    {b.evidence}
                    {b.url && (
                      <small>
                        <a
                          href={safeUrl(b.url)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Original pipeline
                        </a>
                      </small>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="panel-description">
          Job-time sum measures runner work. Wall time is first job start to
          last job end. Queue time is the wait before the first job; these are
          distinct measurements.
        </p>
      </Section>
      {benchmarks.length > 0 && (
        <Section title="Execution and queue comparison" note="Recorded minutes">
          <div className="chart">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart
                data={benchmarks}
                margin={{ top: 20, right: 20, left: 0, bottom: 10 }}
              >
                <CartesianGrid vertical={false} stroke="#e7edf2" />
                <XAxis dataKey="label" />
                <YAxis unit="m" />
                <Tooltip
                  formatter={(v: any) => `${Number(v).toFixed(1)} minutes`}
                />
                <Legend />
                <Bar
                  dataKey="execution"
                  name="Observed execution wall time"
                  fill="#3169c6"
                />
                <Bar
                  dataKey="queue"
                  name="First-job queue wait"
                  fill="#9d7d43"
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Section>
      )}
      <Section title="Job-by-job timing comparison" note="Recorded seconds">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Job</th>
                {measured.map((b: any) => (
                  <th key={b.pipeline_id}>#{b.pipeline_id}</th>
                ))}
                <th>Final vs baseline</th>
              </tr>
            </thead>
            <tbody>
              {archive.job_comparisons.map((j: any) => {
                const baseline = j.seconds[0],
                  end = j.seconds[j.seconds.length - 1],
                  change =
                    baseline > 0 && end != null
                      ? ((baseline - end) / baseline) * 100
                      : null;
                return (
                  <tr key={j.name}>
                    <td>
                      <strong>{j.name}</strong>
                      {j.note && <small>{j.note}</small>}
                    </td>
                    {j.seconds.map((s: number | null, i: number) => (
                      <td key={i}>{s == null ? "—" : `${s}s`}</td>
                    ))}
                    <td>
                      {change == null
                        ? "—"
                        : `${Math.abs(change).toFixed(1)}% ${change >= 0 ? "faster" : "slower"}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>
      {pipeline && (
        <Section
          title={`Recorded jobs · #${pipeline.pipeline_id}`}
          note={
            pipeline.verified_at
              ? `API verified ${new Date(pipeline.verified_at * 1000).toLocaleString()}`
              : "Source report evidence"
          }
        >
          <div className="table-toolbar">
            <select
              aria-label="Recorded pipeline"
              value={selectedIndex}
              onChange={(e) => setSelected(Number(e.target.value))}
            >
              {archive.benchmarks.map((b: any, i: number) => (
                <option value={i} key={b.pipeline_id}>
                  #{b.pipeline_id} · {b.label}
                </option>
              ))}
            </select>
          </div>
          {pipeline.note && (
            <p className="panel-description">{pipeline.note}</p>
          )}
          {pipeline.jobs.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Job / stage</th>
                    <th>Outcome</th>
                    <th>Execution</th>
                    <th>Queue</th>
                    <th>Runner</th>
                  </tr>
                </thead>
                <tbody>
                  {pipeline.jobs.map((j: any) => (
                    <tr key={j.name}>
                      <td>
                        {j.name}
                        <small>{j.stage}</small>
                      </td>
                      <td>
                        <Pill value={j.status} />
                      </td>
                      <td>{duration(j.duration)}</td>
                      <td>{duration(j.queued_duration)}</td>
                      <td>{j.runner || "Not recorded"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty text="Individual job records were not included for this pipeline. The source report records its overall outcome." />
          )}
        </Section>
      )}
      <RecordedOptimizations archive={archive} />
      <Section title="Recorded notes and follow-ups">
        <div className="recorded-notes">
          {archive.notes.map((note: string, i: number) => (
            <p key={i}>{note}</p>
          ))}
        </div>
      </Section>
      <Section title="Source report and provenance">
        <div className="panel-description">
          <p>
            Source: {archive.source_name}. Imported{" "}
            {new Date(archive.imported_at * 1000).toLocaleString()}.
          </p>
          {archive.source_sha256 && (
            <p className="provenance">SHA-256: {archive.source_sha256}</p>
          )}
          <details>
            <summary>Read the complete original survey</summary>
            <pre className="source-report">{archive.source_report}</pre>
          </details>
        </div>
      </Section>
    </>
  );
}

export function RecordedOptimizations({ archive }: { archive: any }) {
  if (!archive) return null;
  return (
    <Section
      title="Recorded optimizations and current checks"
      note="Original status is retained"
    >
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Change</th>
              <th>Recorded status</th>
              <th>Evidence</th>
              <th>Current host check</th>
            </tr>
          </thead>
          <tbody>
            {archive.optimizations.map((o: any) => (
              <tr key={o.key}>
                <td>
                  <strong>{o.title}</strong>
                  <small>
                    {o.scope} · {o.detail}
                  </small>
                </td>
                <td>
                  <Pill value={o.recorded_status} />
                </td>
                <td>{o.evidence || "Source report"}</td>
                <td>
                  <Pill value={o.current_check?.status || "not_verified"} />
                  <small>{o.current_check?.detail}</small>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

export function RunnerInventory({
  docker,
  archive,
  host,
}: {
  docker?: any;
  archive?: any;
  host?: any;
}) {
  const [query, setQuery] = useState("");
  const workers = (docker?.containers || []).filter((c: any) => c.ci);
  const images = (docker?.images || []).filter((i: any) =>
    i.tags.join(" ").toLowerCase().includes(query.toLowerCase()),
  );
  const registry = (archive?.context || {}).registry;
  return (
    <>
      <div className="notice">
        <Server size={18} />
        <div>
          <strong>Runner-host inventory</strong>
          <p>
            Workers, containers, image tags, and cache volumes come directly
            from this Docker host. No GitLab connection is needed. Pipeline
            benchmark evidence is retained under Survey & benchmarks.
          </p>
        </div>
      </div>
      <div className="summary-row">
        <div>
          <Server />
          <strong>{docker?.ci_running ?? "—"}</strong>
          <span>Running CI containers</span>
        </div>
        <div>
          <Box />
          <strong>{docker?.images?.length ?? "—"}</strong>
          <span>Local image IDs · aliases share layers</span>
        </div>
        <div>
          <Box />
          <strong>{docker?.storage?.volumes_count ?? "—"}</strong>
          <span>Docker / runner volumes</span>
        </div>
        <div>
          <Server />
          <strong>{bytes(docker?.storage?.build_cache_bytes)}</strong>
          <span>Docker build cache</span>
        </div>
      </div>
      <Section
        title="CI workers and helper containers"
        note="Live Docker state"
      >
        {workers.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Container</th>
                  <th>State / role</th>
                  <th>Image</th>
                  <th>Job / project</th>
                  <th>CPU / RAM</th>
                </tr>
              </thead>
              <tbody>
                {workers.map((c: any) => (
                  <tr key={c.id}>
                    <td>{c.name}</td>
                    <td>
                      <Pill value={c.state} />
                      <small>{c.ci_metadata?.role || "Role not labeled"}</small>
                    </td>
                    <td>{c.image}</td>
                    <td>
                      {c.ci_metadata?.job_id || "Not labeled"}
                      <small>
                        {c.ci_metadata?.project_path ||
                          c.ci_metadata?.project_id}
                      </small>
                    </td>
                    <td>
                      {c.cpu_percent == null
                        ? "—"
                        : `${c.cpu_percent.toFixed(1)}%`}{" "}
                      / {bytes(c.memory_bytes)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            text={
              docker
                ? "No CI containers are currently present. This is an idle host, not a missing worker count."
                : "Docker inventory is unavailable."
            }
          />
        )}
      </Section>
      <Section
        title="Observed CI container history"
        note="Retained across application restarts"
      >
        <p className="muted">
          Sampled every 15 seconds. Short-lived containers can be missed;
          disappearance does not establish a job outcome.
        </p>
        {docker?.worker_history?.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Container / image</th>
                  <th>Last observed state</th>
                  <th>First / last seen</th>
                  <th>Observed CPU / RAM peaks</th>
                </tr>
              </thead>
              <tbody>
                {docker.worker_history.map((c: any) => (
                  <tr key={c.id}>
                    <td>
                      {c.name}
                      <small>{c.image}</small>
                    </td>
                    <td>
                      <Pill value={c.state} />
                      <small>{c.status}</small>
                    </td>
                    <td>
                      {new Date(c.first_seen * 1000).toLocaleString()}
                      <small>
                        {new Date(c.last_seen * 1000).toLocaleString()}
                      </small>
                    </td>
                    <td>
                      {c.cpu_peak == null ? "—" : `${c.cpu_peak.toFixed(1)}%`} /{" "}
                      {bytes(c.memory_peak)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty text="CI container history starts when workers are first observed." />
        )}
      </Section>
      <Section
        title="Pipeline and toolchain images on this host"
        note={
          docker?.images_updated_at
            ? `Catalog sampled ${new Date(docker.images_updated_at * 1000).toLocaleTimeString()}`
            : undefined
        }
      >
        <div className="table-toolbar">
          <label className="search">
            <Search size={16} />
            <input
              aria-label="Search pipeline images"
              placeholder="Search image tags or toolchain profiles"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        </div>
        {images.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Tags / image ID</th>
                  <th>Size</th>
                  <th>Created</th>
                  <th>Container references</th>
                </tr>
              </thead>
              <tbody>
                {images.map((i: any) => (
                  <tr key={i.id}>
                    <td>
                      {i.tags.length
                        ? i.tags.map((tag: string) => (
                            <div key={tag}>{tag}</div>
                          ))
                        : "Untagged"}
                      <small>{i.id.slice(0, 24)}</small>
                    </td>
                    <td>{bytes(i.size_bytes)}</td>
                    <td>
                      {i.created
                        ? new Date(i.created * 1000).toLocaleString()
                        : "—"}
                    </td>
                    <td>{i.referencing_containers}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty text="No matching image tags in the current catalog." />
        )}
        <p className="panel-description">
          Sizes share layers and cannot be added to estimate disk usage. Tags
          shown together reference one image ID. This catalog is bounded to 500
          images.
        </p>
      </Section>
      {archive?.image_checks?.length > 0 && (
        <Section title="Survey toolchain availability">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Recorded image tag</th>
                  <th>Currently present</th>
                </tr>
              </thead>
              <tbody>
                {archive.image_checks.map((i: any) => (
                  <tr key={i.tag}>
                    <td>{i.tag}</td>
                    <td>
                      <Pill
                        value={
                          i.present == null
                            ? "unknown"
                            : i.present
                              ? "verified"
                              : "missing"
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}
      <Section
        title="Runner cache and Docker volumes"
        note="Disk-usage data refreshes every five minutes"
      >
        {docker?.storage?.volumes?.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Volume</th>
                  <th>Driver</th>
                  <th>Size</th>
                  <th>References</th>
                  <th>Host path</th>
                </tr>
              </thead>
              <tbody>
                {docker.storage.volumes.map((v: any) => (
                  <tr key={v.name}>
                    <td>{v.name}</td>
                    <td>{v.driver}</td>
                    <td>{bytes(v.size_bytes)}</td>
                    <td>{v.references ?? "—"}</td>
                    <td>{v.mountpoint}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            text={docker?.storage_error || "No volume usage data is available."}
          />
        )}
        <p className="panel-description">
          Docker root: {docker?.root || "Unavailable"}. Runner cache mount:{" "}
          {host?.volumes?.find((v: any) => v.mount === "/cache")?.device ||
            "Not a separate visible mount"}
          .{registry ? ` Registry recorded in survey: ${registry}.` : ""}
        </p>
      </Section>
    </>
  );
}
