import React, { useState } from "react";
import { AlertTriangle, Info, OctagonAlert, Wrench } from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { bytes, pct } from "../../lib/api";
import { records, object, number, age } from "./format";
import {
  NotReported,
  Section,
  Segmented,
  Status,
  StatusDot,
  Table,
  Tabs,
  UsageBar,
} from "./FleetComponents";
import type { Alert, Detail, Point } from "./types";

type TabName = "Resources" | "Containers" | "Runner & services";
const TABS: Array<{ value: TabName; label: string }> = [
  { value: "Resources", label: "Resources" },
  { value: "Containers", label: "Containers" },
  { value: "Runner & services", label: "Runner & services" },
];
const WINDOWS = [
  { value: 1, label: "1h" },
  { value: 6, label: "6h" },
  { value: 24, label: "24h" },
  { value: 168, label: "7d" },
];
const SOURCES = [
  ["host", "Host"],
  ["docker", "Docker"],
  ["gpu", "GPU"],
  ["runner", "Runner"],
  ["services", "Services"],
] as const;
/** Short remedies for the collector failures agents report most often. */
function fixHint(key: string, message: string): string | null {
  if (key === "docker" && /permission denied/i.test(message))
    return "Set OPSDECK_DOCKER_GID to the group of /var/run/docker.sock and restart the agent.";
  if (key === "docker" && /did not answer|timed out/i.test(message))
    return "Time 'docker ps' on the host; if it is slow, raise OPSDECK_DOCKER_TIMEOUT.";
  if (key === "runner" && /listener/i.test(message))
    return "Enable the runner listen_address (scripts/runner/tune-runner-host.sh metrics), or uncheck Runner under Monitored collectors.";
  if (key === "services" && /systemd bus/i.test(message))
    return "Schedule deploy.export_services with compose.services.yaml, or uncheck Services under Monitored collectors.";
  return null;
}
const axis = {
  stroke: "var(--chart-tick)",
  tick: { fill: "var(--chart-tick)", fontSize: 12 },
  tickLine: false,
};

/** [name, has data, full width, element] */
type Panel = [string, boolean, boolean, React.ReactNode];

/** A string or number value, or a muted "Not reported". */
function cell(value: unknown): React.ReactNode {
  return typeof value === "string" || typeof value === "number" ? (
    String(value)
  ) : (
    <NotReported />
  );
}
function amount(value: unknown, format: (v: number) => string) {
  const v = number(value);
  return v === null ? <NotReported /> : format(v);
}
const rate = (v: number) => `${bytes(v)}/s`;

/** One readout: label, display numeral, usage bar and a secondary line. */
function Readout({
  label,
  value,
  bar,
  tone,
  children,
}: {
  label: string;
  value: string | null;
  bar?: number | null;
  tone?: "accent";
  children: React.ReactNode;
}) {
  return (
    <div className="fleet-readout">
      <span className="fleet-readout-label">{label}</span>
      {value === null ? (
        <strong className="is-na">Not reported</strong>
      ) : (
        <strong>{value}</strong>
      )}
      {bar !== undefined ? (
        <UsageBar value={bar} tone={tone} />
      ) : (
        <span className="fleet-usage fleet-usage-spacer" aria-hidden="true" />
      )}
      <small>{children}</small>
    </div>
  );
}

export function NodeDetail({
  detail,
  history,
  hours,
  onHours,
  alerts = [],
}: {
  detail: Detail;
  history: Point[];
  hours: number;
  onHours: (hours: number) => void;
  alerts?: Alert[];
}) {
  const { node, sources } = detail;
  const host = object(sources.host?.data),
    docker = object(sources.docker?.data),
    runner = object(sources.runner?.data);
  const cpu = object(host.cpu),
    memory = object(host.memory),
    storage = object(docker.storage),
    facts = object(runner.facts);
  const [tab, setTab] = useState<TabName>("Resources");

  const cpuPct = number(cpu.percent),
    memPct = number(memory.percent),
    cores = number(cpu.cores),
    threads = number(cpu.threads),
    memUsed = number(memory.used),
    memTotal = number(memory.total),
    ci = number(docker.ci_running),
    slots = number(facts.concurrent);

  const volumes = records(host.volumes),
    disks = records(host.disks),
    network = records(host.network),
    gpus = records(sources.gpu?.data),
    processes = records(host.top_processes),
    containers = records(docker.containers),
    images = records(docker.images),
    runners = records(facts.runners),
    metrics = Object.entries(object(runner.metrics)),
    services = records(sources.services?.data);
  const buildCache = number(storage.build_cache_bytes),
    reclaimable = number(storage.build_cache_reclaimable_bytes);

  // Panels with data render in full; empty ones collapse into one quiet list.
  const resourcePanels: Panel[] = [
    [
      "Filesystems",
      volumes.length > 0,
      true,
      <Section title="Filesystems">
        <Table
          headings={["Mount", "Device", "Used", "Capacity", "Usage"]}
          numeric={["Used", "Capacity"]}
        >
          {volumes.map((v, i) => (
            <tr key={i}>
              <td>{cell(v.mount)}</td>
              <td className="fleet-muted-cell">{cell(v.device)}</td>
              <td className="num">{amount(v.used, bytes)}</td>
              <td className="num">{amount(v.total, bytes)}</td>
              <td className="fleet-usage-cell">
                <div>
                  <UsageBar value={number(v.percent)} />
                  <span>{amount(v.percent, (p) => `${p.toFixed(1)}%`)}</span>
                </div>
              </td>
            </tr>
          ))}
        </Table>
      </Section>,
    ],
    [
      "GPUs",
      gpus.length > 0,
      false,
      <Section title="GPUs">
        <Table
          headings={["Device", "Utilization", "VRAM used", "Temperature"]}
          numeric={["VRAM used", "Temperature"]}
        >
          {gpus.map((v, i) => (
            <tr key={i}>
              <td>{typeof v.name === "string" ? v.name : `GPU ${i}`}</td>
              <td className="fleet-usage-cell">
                <div>
                  <UsageBar value={number(v.utilization)} />
                  <span>
                    {amount(v.utilization, (p) => `${p.toFixed(1)}%`)}
                  </span>
                </div>
              </td>
              <td className="num">
                {amount(v.memory_used_mib, (m) => bytes(m * 1024 * 1024))}
              </td>
              <td className="num">
                {amount(v.temperature, (t) => `${Math.round(t)} °C`)}
              </td>
            </tr>
          ))}
        </Table>
      </Section>,
    ],
    [
      "Top processes",
      processes.length > 0,
      false,
      <Section title="Top processes by memory">
        <Table
          headings={["Process", "PID", "Memory"]}
          numeric={["PID", "Memory"]}
        >
          {processes.map((v, i) => (
            <tr key={i}>
              <td>{cell(v.name)}</td>
              <td className="num fleet-muted-cell">{cell(v.pid)}</td>
              <td className="num">{amount(v.memory_bytes, bytes)}</td>
            </tr>
          ))}
        </Table>
      </Section>,
    ],
    [
      "Disk activity",
      disks.length > 0,
      false,
      <Section title="Disk activity">
        <Table
          headings={["Disk", "Read", "Write", "IOPS", "Latency"]}
          numeric={["Read", "Write", "IOPS", "Latency"]}
        >
          {disks.map((v, i) => (
            <tr key={i}>
              <td>{cell(v.name)}</td>
              <td className="num">{amount(v.read_bytes_s, rate)}</td>
              <td className="num">{amount(v.write_bytes_s, rate)}</td>
              <td className="num">
                {amount(v.iops, (n) => Math.round(n).toLocaleString())}
              </td>
              <td className="num">
                {amount(v.await_ms, (n) => `${n.toFixed(1)} ms`)}
              </td>
            </tr>
          ))}
        </Table>
      </Section>,
    ],
    [
      "Network",
      network.length > 0,
      false,
      <Section title="Network">
        <Table
          headings={["Interface", "Link", "Receive", "Send"]}
          numeric={["Receive", "Send"]}
        >
          {network.map((v, i) => (
            <tr key={i}>
              <td>{cell(v.name)}</td>
              <td>
                <span className="fleet-state">
                  <StatusDot value={v.up ? "online" : "waiting"} />
                  {v.up ? "Up" : "Down"}
                </span>
              </td>
              <td className="num">{amount(v.rx_bytes_s, rate)}</td>
              <td className="num">{amount(v.tx_bytes_s, rate)}</td>
            </tr>
          ))}
        </Table>
      </Section>,
    ],
  ];
  const containerPanels: Panel[] = [
    [
      "Containers",
      containers.length > 0,
      true,
      <Section title="Containers">
        <Table
          headings={["Container", "Image", "State", "CPU", "Memory", "CI job"]}
          numeric={["CPU", "Memory"]}
        >
          {containers.map((v, i) => (
            <tr key={i}>
              <td>{cell(v.name)}</td>
              <td className="fleet-muted-cell">{cell(v.image)}</td>
              <td>
                <span className="fleet-state">
                  <StatusDot value={stateTone(v.state)} />
                  {cell(v.state)}
                </span>
              </td>
              <td className="num">{amount(v.cpu_percent, (p) => pct(p))}</td>
              <td className="num">{amount(v.memory_bytes, bytes)}</td>
              <td>
                {object(v.ci_metadata).job_id != null ? (
                  cell(object(v.ci_metadata).job_id)
                ) : (
                  <NotReported>None</NotReported>
                )}
              </td>
            </tr>
          ))}
        </Table>
      </Section>,
    ],
    [
      "Images and build cache",
      images.length > 0 || buildCache !== null,
      true,
      <Section title="Images and build cache">
        <dl className="fleet-facts">
          <div>
            <dt>Build cache</dt>
            <dd>{amount(buildCache, bytes)}</dd>
          </div>
          <div>
            <dt>Reclaimable</dt>
            <dd>{amount(reclaimable, bytes)}</dd>
          </div>
          <div>
            <dt>Images</dt>
            <dd>{images.length}</dd>
          </div>
        </dl>
        <Table
          headings={["Image", "Size", "Referencing containers"]}
          empty="No images reported"
          numeric={["Size", "Referencing containers"]}
        >
          {images.map((v, i) => (
            <tr key={i}>
              <td>
                {Array.isArray(v.tags) && v.tags.length ? (
                  v.tags.map(String).join(", ")
                ) : (
                  <code>{String(v.id ?? "untagged")}</code>
                )}
              </td>
              <td className="num">{amount(v.size_bytes, bytes)}</td>
              <td className="num">{cell(v.referencing_containers)}</td>
            </tr>
          ))}
        </Table>
      </Section>,
    ],
  ];
  const runnerPanels: Panel[] = [
    [
      "Runner configuration",
      runners.length > 0 || slots !== null,
      true,
      <Section title="Runner configuration">
        <Table
          headings={["Runner", "Executor", "Limit", "Request concurrency"]}
          numeric={["Limit", "Request concurrency"]}
        >
          {runners.map((v, i) => (
            <tr key={i}>
              <td>{cell(v.name)}</td>
              <td>{cell(v.executor)}</td>
              <td className="num">{cell(v.limit)}</td>
              <td className="num">{cell(v.request_concurrency)}</td>
            </tr>
          ))}
        </Table>
        <p className="fleet-footnote">
          Host concurrency {slots ?? "not reported"}. Runner credentials are
          excluded from telemetry.
        </p>
      </Section>,
    ],
    [
      "Services",
      services.length > 0,
      false,
      <Section title="Services">
        <Table headings={["Service", "State", "Substate"]}>
          {services.map((v, i) => (
            <tr key={i}>
              <td>{cell(v.name)}</td>
              <td>
                <span className="fleet-state">
                  <StatusDot value={stateTone(v.state)} />
                  {cell(v.state)}
                </span>
              </td>
              <td className="fleet-muted-cell">{cell(v.substate)}</td>
            </tr>
          ))}
        </Table>
      </Section>,
    ],
    [
      "Runner metrics",
      metrics.length > 0,
      false,
      <Section title="Runner metrics">
        <dl className="fleet-kv">
          {metrics.map(([key, value]) => (
            <div key={key}>
              <dt>
                <code>{key}</code>
              </dt>
              <dd>{cell(value)}</dd>
            </div>
          ))}
        </dl>
      </Section>,
    ],
  ];
  const panels =
    tab === "Resources"
      ? resourcePanels
      : tab === "Containers"
        ? containerPanels
        : runnerPanels;
  const shown = panels.filter(([, has]) => has);
  // A half-width panel left alone on its row takes the full row instead.
  const halves = shown.filter(([, , wide]) => !wide);
  const lonely = halves.length % 2 ? halves[halves.length - 1][0] : "";
  const missing = panels.filter(([, has]) => !has).map(([name]) => name);

  return (
    <>
      <header className="fleet-node-heading">
        <div className="fleet-node-id">
          <h1>{node.name}</h1>
          <p className="fleet-node-sub">
            <span>{node.cluster}</span>
            {node.hostname ? (
              <code>{node.hostname}</code>
            ) : (
              <span className="fleet-na">Waiting for hostname</span>
            )}
          </p>
        </div>
        <div className="fleet-node-badges">
          {!!node.maintenance && (
            <span className="fleet-badge">
              <Wrench size={12} aria-hidden="true" />
              Maintenance
            </span>
          )}
          <Status value={node.status} pill />
        </div>
      </header>
      <dl className="fleet-node-meta">
        <div>
          <dt>Last observation</dt>
          <dd>{age(node.age_seconds)}</dd>
        </div>
        <div>
          <dt>Collection scope</dt>
          <dd>{node.scope || <NotReported />}</dd>
        </div>
      </dl>
      {node.notes && <p className="fleet-node-notes">{node.notes}</p>}
      {alerts.length > 0 && (
        <ul className="fleet-node-alerts" aria-label="Host alerts">
          {alerts.map((alert) => (
            <li
              key={alert.key}
              className={`fleet-banner fleet-banner-${alert.severity === "critical" ? "bad" : "warn"}`}
            >
              {alert.severity === "critical" ? (
                <OctagonAlert size={16} aria-hidden="true" />
              ) : (
                <AlertTriangle size={16} aria-hidden="true" />
              )}
              <span>
                <span className="visually-hidden">
                  {alert.severity === "critical" ? "Critical: " : "Warning: "}
                </span>
                <strong>{alert.title}</strong>
                <small>{alert.detail}</small>
              </span>
            </li>
          ))}
        </ul>
      )}
      {!!node.maintenance && (
        <p className="fleet-banner fleet-banner-info" role="status">
          <Wrench size={16} aria-hidden="true" />
          <span>
            This host is in maintenance. Its alerts are suppressed until
            maintenance is turned off in Host settings.
          </span>
        </p>
      )}
      {node.status !== "online" && (
        <p
          className={`fleet-banner fleet-banner-${node.status === "revoked" ? "warn" : "info"}`}
          role="status"
        >
          <Info size={16} aria-hidden="true" />
          <span>
            {node.status === "revoked"
              ? "This agent is revoked. Rotate its credential to reconnect it."
              : node.status === "waiting"
                ? "Start the agent on this host to receive its first observation."
                : "These are retained observations. Check the agent service, outbound connectivity, and host clock."}
          </span>
        </p>
      )}
      <ul className="fleet-source-grid" aria-label="Collectors">
        {SOURCES.map(([key, label]) => {
          const source = sources[key];
          if (key !== "host" && node.ignored_sources?.includes(key))
            return (
              <li key={key} className="fleet-source-ignored">
                <span className="fleet-source-head">
                  <strong>{label}</strong>
                  <Status value="not_monitored" pill />
                </span>
                <small>
                  Not monitored on this host; it raises no alerts. Change this
                  in Host settings.
                </small>
              </li>
            );
          const status = source?.stale ? "stale" : source?.status || "waiting";
          const hint =
            status !== "healthy" && source?.message
              ? fixHint(key, source.message)
              : null;
          return (
            <li key={key}>
              <span className="fleet-source-head">
                <strong>{label}</strong>
                <Status value={status} />
              </span>
              <small>
                {source?.message ||
                  (source?.age_seconds != null
                    ? `Updated ${age(source.age_seconds)}`
                    : source
                      ? "Not reported by this agent"
                      : "Waiting for telemetry")}
              </small>
              {hint && (
                <small className="fleet-source-fix">
                  <b>How to fix:</b> {hint} See &ldquo;Agent collector shows
                  unavailable&rdquo; in the troubleshooting guide.
                </small>
              )}
            </li>
          );
        })}
      </ul>
      <Tabs
        label="Host views"
        idPrefix="host-view"
        tabs={TABS}
        value={tab}
        onChange={setTab}
      />
      <div
        className="fleet-tabpanel"
        role="tabpanel"
        id="host-view-panel"
        aria-labelledby={`host-view-tab-${TABS.findIndex((t) => t.value === tab)}`}
      >
        {tab === "Resources" && (
          <>
            <div
              className="fleet-capacity"
              data-retained={node.status !== "online" || undefined}
            >
              <Readout
                label="CPU"
                value={cpuPct === null ? null : pct(cpuPct)}
                bar={cpuPct}
              >
                {cores === null ? (
                  <NotReported>Core count not reported</NotReported>
                ) : (
                  `${cores} cores${threads === null ? "" : `, ${threads} threads`}`
                )}
              </Readout>
              <Readout
                label="Memory"
                value={memPct === null ? null : pct(memPct)}
                bar={memPct}
              >
                {memUsed === null || memTotal === null ? (
                  <NotReported>Capacity not reported</NotReported>
                ) : (
                  `${bytes(memUsed)} of ${bytes(memTotal)}`
                )}
              </Readout>
              <Readout
                label="Running CI workers"
                value={ci === null ? null : String(ci)}
                bar={
                  ci !== null && slots
                    ? Math.min(100, (ci / slots) * 100)
                    : undefined
                }
                tone="accent"
              >
                {ci !== null && slots
                  ? `${ci} of ${slots} concurrent slots in use`
                  : "Observed in this host's Docker engine"}
              </Readout>
            </div>
            <Section
              title="Resource history"
              actions={
                <Segmented
                  label="History window"
                  value={hours}
                  onChange={onHours}
                  options={WINDOWS}
                />
              }
            >
              {history.length ? (
                <div className="fleet-history">
                  <ul className="fleet-chart-legend">
                    <li>
                      <i className="swatch-cpu" />
                      CPU
                    </li>
                    <li>
                      <i className="swatch-memory" />
                      Memory
                    </li>
                  </ul>
                  <div className="fleet-chart">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart
                        data={history}
                        margin={{ top: 8, right: 8, left: -12, bottom: 0 }}
                      >
                        <CartesianGrid
                          stroke="var(--chart-grid)"
                          vertical={false}
                        />
                        <XAxis
                          dataKey="ts"
                          type="number"
                          domain={["dataMin", "dataMax"]}
                          minTickGap={36}
                          tickFormatter={(v) =>
                            new Date(v * 1000).toLocaleString(
                              [],
                              hours > 24
                                ? { month: "short", day: "numeric" }
                                : { hour: "2-digit", minute: "2-digit" },
                            )
                          }
                          {...axis}
                        />
                        <YAxis
                          domain={[0, 100]}
                          ticks={[0, 25, 50, 75, 100]}
                          unit="%"
                          {...axis}
                        />
                        <Tooltip
                          labelFormatter={(v) =>
                            new Date(Number(v) * 1000).toLocaleString()
                          }
                          formatter={(value) =>
                            typeof value === "number"
                              ? `${value.toFixed(1)}%`
                              : "No data"
                          }
                          contentStyle={{
                            background: "var(--surface)",
                            border: "1px solid var(--border)",
                            borderRadius: 6,
                            color: "var(--text)",
                            fontSize: 12,
                          }}
                        />
                        <Line
                          dataKey="cpu"
                          name="CPU"
                          stroke="var(--series-1)"
                          strokeWidth={1.75}
                          dot={false}
                          connectNulls={false}
                          isAnimationActive={false}
                        />
                        <Line
                          dataKey="memory"
                          name="Memory"
                          stroke="var(--series-2)"
                          strokeWidth={1.75}
                          dot={false}
                          connectNulls={false}
                          isAnimationActive={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              ) : (
                <p className="fleet-empty">
                  History will appear after this agent sends telemetry.
                </p>
              )}
            </Section>
          </>
        )}
        {shown.length > 0 && (
          <div className="fleet-panels">
            {shown.map(([name, , wide, panel]) => (
              <div
                key={name}
                className={
                  wide || name === lonely ? "fleet-panel-wide" : undefined
                }
              >
                {panel}
              </div>
            ))}
          </div>
        )}
        {missing.length > 0 && (
          <section className="fleet-missing" aria-label="Not reported">
            <strong>Not reported by this agent</strong>
            <ul>
              {missing.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
            <small>
              {tab === "Resources"
                ? "Panels appear once the host collector sends them."
                : tab === "Containers"
                  ? "Check the Docker collector status above."
                  : "Check the runner and services collectors above."}
            </small>
          </section>
        )}
      </div>
    </>
  );
}

/** Map a container or systemd state onto the shared status dot colors. */
function stateTone(state: unknown) {
  const s = typeof state === "string" ? state.toLowerCase() : "";
  if (["running", "active", "healthy"].includes(s)) return "online";
  if (["failed", "error", "unhealthy"].includes(s)) return "offline";
  if (["restarting", "activating", "reloading", "paused"].includes(s))
    return "stale";
  return "waiting";
}
