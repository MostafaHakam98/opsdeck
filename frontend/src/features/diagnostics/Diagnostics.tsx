import { Activity, ArrowRight, Clock3, Database, LifeBuoy } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  bytes,
  duration,
  pct,
  type History,
  type Snapshot,
} from "../../lib/api";
import { PaginatedList } from "../../components/PaginatedList";
import { Badge } from "../../components/Status";
import { distribution, historyDistribution, pipelineOutcomes } from "./metrics";

const tooltip = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  color: "var(--text)",
};
const tick = { fill: "var(--chart-tick)", fontSize: 11 };

export function SupportOverview({
  snapshot,
  onNavigate,
}: {
  snapshot: Snapshot;
  onNavigate: (page: string) => void;
}) {
  const sources = Object.entries(snapshot.sources);
  const healthy = sources.filter(
    ([, source]) => source.status === "healthy" && !source.stale,
  ).length;
  const critical = snapshot.alerts.filter(
    (alert) => alert.severity === "critical",
  ).length;
  const host = snapshot.sources.host;
  const io = host?.data?.pressure?.io?.some?.avg60;
  const memory = host?.data?.memory?.percent;
  const currentHost = host?.status === "healthy" && !host.stale;
  const focus = !currentHost
    ? {
        title: "Confirm the host connection",
        text: "Current host health cannot be assessed. Check collector freshness before diagnosing user workloads.",
        page: "connections",
        tone: "warn",
      }
    : critical
      ? {
          title: "Investigate critical conditions",
          text: `${critical} critical condition(s) need review. Start with the affected service or resource in the activity view.`,
          page: "activity",
          tone: "bad",
        }
      : memory >= 90
        ? {
            title: "Investigate memory contention",
            text: "Memory use is at least 90%. Review the largest processes and available memory before increasing workload concurrency.",
            page: "host",
            tone: "warn",
          }
        : io > 10
          ? {
              title: "Investigate storage wait",
              text: "Tasks spent more than 10% of the last minute waiting for I/O. Compare disk latency with the active workload.",
              page: "host",
              tone: "warn",
            }
          : snapshot.alerts.length
            ? {
                title: "Review active conditions",
                text: "Check alerts and source coverage before making capacity changes. Each condition includes the measured evidence.",
                page: "activity",
                tone: "warn",
              }
            : {
                title: "Start with the affected workload",
                text: "No threshold alerts in available data. Filter by repository or pipeline, then compare queue wait and execution time.",
                page: "projects",
                tone: "info",
              };
  return (
    <section className="support-overview" aria-label="Support triage">
      <div className={`support-focus ${focus.tone}`}>
        <LifeBuoy size={25} aria-hidden="true" />
        <div>
          <span className="support-label">Where to start</span>
          <h2>{focus.title}</h2>
          <p>{focus.text}</p>
          <button
            className="text-button"
            onClick={() => onNavigate(focus.page)}
          >
            Investigate <ArrowRight size={15} />
          </button>
        </div>
      </div>
      <dl className="support-facts">
        <div>
          <dt>Fresh integrations</dt>
          <dd>
            {healthy}
            <span> / {sources.length}</span>
          </dd>
          <small>Unknown sources need a connection check</small>
        </div>
        <div>
          <dt>Active conditions</dt>
          <dd>
            {snapshot.alerts.length}
            <span> / {critical} critical</span>
          </dd>
          <small>Based on available telemetry</small>
        </div>
        <div>
          <dt>Refresh cadence</dt>
          <dd>{duration(snapshot.sample_seconds)}</dd>
          <small>Retained for {snapshot.retention_days} days</small>
        </div>
      </dl>
    </section>
  );
}

export function ResourceDiagnostics({
  history,
  snapshot,
}: {
  history: History[];
  snapshot: Snapshot;
}) {
  const cpu = historyDistribution(history, "cpu");
  const memory = historyDistribution(history, "memory");
  const pressure = historyDistribution(history, "io_pressure");
  const source = snapshot.sources.host;
  const host = source?.data;
  const volumes = [...(host?.volumes || [])].sort(
    (a, b) =>
      Math.max(b.percent ?? -1, b.inode_percent ?? -1) -
      Math.max(a.percent ?? -1, a.inode_percent ?? -1),
  );
  const times = history
    .map((sample) => sample.ts)
    .filter((ts) => Number.isFinite(ts));
  const span =
    times.length > 1 ? Math.max(...times) - Math.min(...times) : null;
  return (
    <section className="diagnostics" aria-label="Resource diagnostics">
      <div className="section-heading">
        <div>
          <h2>Resource diagnostics</h2>
          <p>
            Whole-node measurements · {history.length} retained points
            {span != null ? ` across ${duration(span)}` : ""}
          </p>
        </div>
        <Activity size={20} />
      </div>
      <p className="diagnostic-method">
        Averages use retained bucket means; peaks use retained maxima. Missing
        values are excluded. The history range on Overview applies to these
        plots.
        {times.length > 0 &&
          ` Latest point: ${new Date(Math.max(...times) * 1000).toLocaleString()}.`}
      </p>
      {(source?.stale || source?.status !== "healthy") && (
        <p className="notice warn">
          Current host telemetry is stale or unavailable. Historical samples and
          last known filesystem readings do not establish current health.
        </p>
      )}
      <div className="diagnostic-metrics">
        {[
          { name: "CPU", stats: cpu, hint: "Compare with memory and I/O wait" },
          {
            name: "Memory",
            stats: memory,
            hint: "Sustained use matters more than a spike",
          },
          {
            name: "Storage wait",
            stats: pressure,
            hint: "Time tasks spent waiting on storage",
          },
        ].map(({ name, stats, hint }) => (
          <div key={name}>
            <span>{name} average</span>
            <strong>{pct(stats.mean)}</strong>
            <p>
              Peak {pct(stats.peak)}{" "}
              <span>
                · {stats.count}/{history.length} measured
              </span>
            </p>
            <small>{hint}</small>
          </div>
        ))}
      </div>
      <div className="two-column">
        <section className="panel">
          <div className="panel-heading">
            <h3>Storage pressure over time</h3>
            <span>Percent of time waiting</span>
          </div>
          <p className="panel-description">
            High wait with low CPU use can point to a storage bottleneck. The
            10% guide matches the I/O alert threshold; it is not a disk
            utilization limit.
          </p>
          {pressure.count >= 2 ? (
            <div
              className="chart"
              role="img"
              aria-label="Storage pressure timeline with a 10 percent guide"
            >
              <ResponsiveContainer width="100%" height={230}>
                <LineChart
                  data={history}
                  margin={{ top: 12, right: 20, left: 0, bottom: 0 }}
                >
                  <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                  <XAxis
                    dataKey="ts"
                    tick={tick}
                    minTickGap={60}
                    tickFormatter={(value) =>
                      new Date(value * 1000).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    }
                  />
                  <YAxis
                    domain={[0, 100]}
                    tick={tick}
                    tickFormatter={(value) => `${value}%`}
                    width={45}
                  />
                  <Tooltip
                    contentStyle={tooltip}
                    formatter={(value) => pct(Number(value))}
                    labelFormatter={(value) =>
                      new Date(Number(value) * 1000).toLocaleString()
                    }
                  />
                  <ReferenceLine
                    y={10}
                    stroke="var(--warn)"
                    strokeDasharray="5 5"
                  />
                  <Line
                    dataKey="io_pressure"
                    name="Storage wait"
                    stroke="var(--series-4)"
                    strokeWidth={2}
                    dot={{ r: 3, strokeWidth: 1, fill: "var(--surface)" }}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="list-empty">
              Waiting for two measured storage-pressure samples. Missing values
              are not counted as zero.
            </p>
          )}
        </section>
        <section className="panel">
          <div className="panel-heading">
            <h3>Filesystem risk ranking</h3>
            <Database size={16} />
          </div>
          <p className="panel-description">
            Highest byte or inode usage first. Review free bytes and inode use
            together; either can prevent users from writing files.
          </p>
          <PaginatedList
            items={volumes as any[]}
            label="Filesystem risk"
            initialSize={5}
          >
            {(rows) => (
              <div className="filesystem-ranking">
                {rows.map((volume) => (
                  <div className="filesystem-risk" key={volume.mount}>
                    <div>
                      <strong>{volume.mount}</strong>
                      <Badge
                        value={
                          volume.percent >= 95
                            ? "critical"
                            : volume.percent >= 85 || volume.inode_percent >= 85
                              ? "warning"
                              : volume.percent == null ||
                                  volume.inode_percent == null
                                ? "unknown"
                                : "healthy"
                        }
                      />
                    </div>
                    <div className="risk-track">
                      <span
                        style={{
                          width: `${Math.max(0, Math.min(100, volume.percent ?? 0))}%`,
                          background:
                            volume.percent >= 95
                              ? "var(--bad)"
                              : volume.percent >= 85
                                ? "var(--warn)"
                                : "var(--series-1)",
                        }}
                      />
                    </div>
                    <p>
                      {pct(volume.percent)} used · {bytes(volume.free)} free ·{" "}
                      {pct(volume.inode_percent)} inodes
                    </p>
                  </div>
                ))}
              </div>
            )}
          </PaginatedList>
        </section>
      </div>
    </section>
  );
}

type Pipeline = {
  id: number;
  project?: string;
  status: string;
  duration?: number | null;
  queued_duration?: number | null;
};
type Job = {
  id: number;
  name: string;
  project?: string;
  status: string;
  duration?: number | null;
  queued_duration?: number | null;
};

export function PipelineDiagnostics({
  pipelines,
  jobs,
  fresh,
}: {
  pipelines: Pipeline[];
  jobs: Job[];
  fresh: boolean;
}) {
  const outcomes = pipelineOutcomes(pipelines);
  const successful = pipelines.filter(
    (pipeline) => pipeline.status === "success",
  );
  const completed = pipelines.filter((pipeline) =>
    ["success", "failed"].includes(pipeline.status),
  );
  const timing = distribution(successful.map((pipeline) => pipeline.duration));
  const waits = distribution(jobs.map((job) => job.queued_duration));
  const slowJobs = jobs
    .filter(
      (job) =>
        typeof job.duration === "number" &&
        Number.isFinite(job.duration) &&
        job.duration >= 0,
    )
    .sort((a, b) => b.duration! - a.duration!);
  const successRate = completed.length
    ? (successful.length / completed.length) * 100
    : null;
  return (
    <section className="diagnostics" aria-label="Pipeline diagnostics">
      <div className="section-heading">
        <div>
          <h2>Pipeline diagnostics</h2>
          <p>
            Selected workload scope · {pipelines.length} pipelines ·{" "}
            {jobs.length} jobs in the GitLab collector sample
          </p>
        </div>
        <Clock3 size={20} />
      </div>
      {!fresh && (
        <p className="notice warn">
          GitLab data is stale or unavailable. Results below describe the last
          collected sample. Connect or refresh GitLab to assess current workload
          health.
        </p>
      )}
      <div className="diagnostic-metrics">
        <div>
          <span>Success among success / failed</span>
          <strong>{pct(successRate)}</strong>
          <p>
            {successful.length} successful / {completed.length} decided
          </p>
          <small>Other states are excluded from this rate</small>
        </div>
        <div>
          <span>Successful execution p95</span>
          <strong>{duration(timing.p95)}</strong>
          <p>{timing.count} measured successful pipelines</p>
          <small>Nearest-rank p95 of this sample, not fleet-wide</small>
        </div>
        <div>
          <span>Job queue wait p95</span>
          <strong>{duration(waits.p95)}</strong>
          <p>{waits.count} jobs with measured queue time</p>
          <small>Missing queue times are excluded</small>
        </div>
      </div>
      <div className="two-column">
        <section className="panel">
          <div className="panel-heading">
            <h3>Pipeline outcomes</h3>
            <span>Counts, not percentages</span>
          </div>
          {pipelines.length ? (
            <div
              className="chart"
              role="img"
              aria-label={`Pipeline outcomes: ${outcomes.map((row) => `${row.name} ${row.count}`).join(", ")}`}
            >
              <ResponsiveContainer width="100%" height={250}>
                <BarChart
                  data={outcomes}
                  layout="vertical"
                  margin={{ left: 5, right: 25 }}
                >
                  <CartesianGrid
                    horizontal={false}
                    stroke="var(--chart-grid)"
                  />
                  <XAxis type="number" allowDecimals={false} tick={tick} />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={120}
                    tick={tick}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip
                    contentStyle={tooltip}
                    cursor={{ fill: "var(--surface-3)" }}
                  />
                  <Bar
                    dataKey="count"
                    name="Pipelines"
                    isAnimationActive={false}
                    radius={[0, 4, 4, 0]}
                  >
                    {outcomes.map((row) => (
                      <Cell key={row.name} fill={row.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="list-empty">
              No GitLab pipeline results in this scope. Connect GitLab or select
              another repository.
            </p>
          )}
          {pipelines.length > 0 && (
            <dl
              className="outcome-breakdown"
              aria-label="Pipeline outcome counts"
            >
              {outcomes.map((outcome) => (
                <div key={outcome.name}>
                  <dt>
                    <i style={{ background: outcome.color }} />
                    {outcome.name}
                  </dt>
                  <dd>
                    {outcome.count}
                    <small>
                      {((outcome.count / pipelines.length) * 100).toFixed(1)}%
                    </small>
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </section>
        <section className="panel">
          <div className="panel-heading">
            <h3>Jobs with the longest execution</h3>
            <span>Queue is shown separately</span>
          </div>
          <PaginatedList
            items={slowJobs}
            label="Job timing chart"
            initialSize={5}
            resetKey={pipelines
              .map((row) => `${row.project}:${row.id}`)
              .join(",")}
          >
            {(rows) => (
              <>
                <div
                  className="chart"
                  role="img"
                  aria-label="Execution and queue seconds by job"
                >
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart
                      data={rows.map((job) => ({
                        ...job,
                        label: `${job.name} #${job.id}`,
                        queue:
                          typeof job.queued_duration === "number" &&
                          job.queued_duration >= 0
                            ? job.queued_duration
                            : null,
                      }))}
                      margin={{ top: 10, right: 20, left: 0, bottom: 25 }}
                    >
                      <CartesianGrid
                        vertical={false}
                        stroke="var(--chart-grid)"
                      />
                      <XAxis
                        dataKey="label"
                        tick={tick}
                        tickFormatter={(value: string) =>
                          `#${value.split(" #").at(-1)}`
                        }
                        interval="preserveStartEnd"
                        minTickGap={8}
                      />
                      <YAxis
                        tick={tick}
                        tickFormatter={(value) => duration(value)}
                        width={55}
                      />
                      <Tooltip
                        contentStyle={tooltip}
                        formatter={(value) => duration(Number(value))}
                        cursor={{ fill: "var(--surface-3)" }}
                      />
                      <Bar
                        dataKey="duration"
                        name="Execution"
                        fill="var(--series-1)"
                        isAnimationActive={false}
                        radius={[3, 3, 0, 0]}
                      />
                      <Bar
                        dataKey="queue"
                        name="Queue wait"
                        fill="var(--series-4)"
                        isAnimationActive={false}
                        radius={[3, 3, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="legend">
                  <span>
                    <i style={{ background: "var(--series-1)" }} />
                    Execution
                  </span>
                  <span>
                    <i style={{ background: "var(--series-4)" }} />
                    Queue wait
                  </span>
                </div>
                <div className="timing-details">
                  {rows.map((job) => (
                    <p key={`${job.project}:${job.id}`}>
                      <strong>
                        {job.name} <small>#{job.id}</small>
                      </strong>
                      <span>
                        {job.project} · <Badge value={job.status} /> ·{" "}
                        {duration(job.duration)} execution /{" "}
                        {duration(job.queued_duration)} queue
                      </span>
                    </p>
                  ))}
                </div>
              </>
            )}
          </PaginatedList>
        </section>
      </div>
    </section>
  );
}
