import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  ClipboardList,
  ArrowDown,
  ArrowUp,
  Box,
  Check,
  ChevronRight,
  CircleHelp,
  Cpu,
  Download,
  ExternalLink,
  Gauge,
  GitBranch,
  HardDrive,
  LayoutDashboard,
  LogOut,
  MemoryStick,
  Network,
  RefreshCw,
  Search,
  Server,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Thermometer,
  TriangleAlert,
  X,
  Zap,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  api,
  bytes,
  download,
  duration,
  pct,
  safeUrl,
  type Event,
  type History,
  type Plan,
  type Snapshot,
  type Source,
} from "../lib/api";
import "./styles.css";
import {
  SurveyPage,
  RunnerInventory,
  RecordedOptimizations,
} from "../features/runners/RunnerStack";

const pages = [
  { id: "overview", title: "Overview", icon: LayoutDashboard },
  { id: "host", title: "Host & hardware", icon: Server },
  { id: "docker", title: "Docker", icon: Box },
  { id: "gitlab", title: "Runner stack", icon: GitBranch },
  { id: "survey", title: "Survey & benchmarks", icon: ClipboardList },
  { id: "optimization", title: "Optimization", icon: Zap },
  { id: "activity", title: "Activity & audit", icon: Activity },
  { id: "connections", title: "Connections", icon: Settings },
];
const good = new Set([
  "healthy",
  "running",
  "active",
  "success",
  "passed",
  "accepted",
]);
const bad = new Set(["critical", "failed", "unavailable", "unhealthy"]);
function Badge({ value }: { value: string }) {
  return (
    <span
      className={`badge ${good.has(value) ? "good" : bad.has(value) ? "bad" : "muted"}`}
    >
      <i />
      {value.replaceAll("_", " ")}
    </span>
  );
}
function SourceNotice({ source, name }: { source?: Source; name: string }) {
  if (!source || (source.status === "healthy" && !source.stale)) return null;
  return (
    <div className="notice">
      <TriangleAlert size={18} />
      <div>
        <strong>
          {source.stale
            ? `${name} data is stale`
            : `${name}: ${source.status.replaceAll("_", " ")}`}
        </strong>
        <p>
          {source.message ||
            "Check the collector and connectivity. Other integrations continue collecting."}
        </p>
      </div>
    </div>
  );
}
function Meter({
  value,
  color = "blue",
}: {
  value?: number | null;
  color?: string;
}) {
  return (
    <div
      className={`meter ${color}`}
      role="meter"
      aria-label="Usage"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value ?? undefined}
    >
      <span style={{ width: `${Math.max(0, Math.min(100, value || 0))}%` }} />
    </div>
  );
}
function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div className="empty">
      <CircleHelp size={28} />
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
function Panel({
  title,
  note,
  children,
  className = "",
}: {
  title: string;
  note?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      <div className="panel-heading">
        <h2>{title}</h2>
        {note && <span>{note}</span>}
      </div>
      {children}
    </section>
  );
}
function Chart({
  history,
  keys,
  percent = true,
}: {
  history: History[];
  keys: Array<[string, string, string]>;
  percent?: boolean;
}) {
  if (history.length < 2)
    return (
      <Empty
        title="History is collecting"
        text="The first chart appears after two retained samples. Leave the collector running to build a timeline."
      />
    );
  const ChartType = percent ? AreaChart : LineChart;
  return (
    <div
      className="chart"
      aria-label={`Time series for ${keys.map((k) => k[1]).join(", ")}`}
    >
      <ResponsiveContainer width="100%" height={240}>
        <ChartType
          data={history}
          margin={{ top: 12, right: 8, left: 0, bottom: 0 }}
        >
          <CartesianGrid stroke="#e7edf2" vertical={false} />
          <XAxis
            dataKey="ts"
            tickFormatter={(v) =>
              new Date(v * 1000).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })
            }
            tick={{ fill: "#65758a", fontSize: 11 }}
            minTickGap={60}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            width={48}
            domain={percent ? [0, 100] : [0, "auto"]}
            tickFormatter={(v) => (percent ? `${v}%` : bytes(v))}
            tick={{ fill: "#65758a", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            labelFormatter={(v) => new Date(Number(v) * 1000).toLocaleString()}
            formatter={(v: any, name: any) => [
              percent ? pct(Number(v)) : `${bytes(Number(v))}/s`,
              name,
            ]}
            contentStyle={{ border: "1px solid #dce5ee", borderRadius: 8 }}
          />
          {keys.map(([key, label, color]) =>
            percent ? (
              <Area
                key={key}
                type="monotone"
                dataKey={key}
                name={label}
                stroke={color}
                fill={color}
                fillOpacity={0.06}
                strokeWidth={2}
                isAnimationActive={false}
                connectNulls={false}
              />
            ) : (
              <Line
                key={key}
                type="monotone"
                dataKey={key}
                name={label}
                stroke={color}
                dot={false}
                strokeWidth={2}
                isAnimationActive={false}
                connectNulls={false}
              />
            ),
          )}
        </ChartType>
      </ResponsiveContainer>
      <div className="legend">
        {keys.map(([key, label, color]) => (
          <span key={key}>
            <i style={{ background: color }} />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
function SignIn({ onSignIn }: { onSignIn: (token: string) => void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <main className="login">
      <div className="login-brand">
        <Gauge size={38} />
        <span>OpsDeck</span>
        <p>Your infrastructure, in view.</p>
      </div>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await api("snapshot", value);
            onSignIn(value);
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <ShieldCheck size={24} />
        <h1>Open your workspace</h1>
        <p>
          Use the access token configured on your server. It stays in this
          browser tab for the session.
        </p>
        <label htmlFor="token">Access token</label>
        <input
          id="token"
          type="password"
          autoComplete="off"
          required
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Enter your server access token"
        />
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="primary" disabled={busy}>
          {busy ? "Connecting…" : "Connect to OpsDeck"}
          <ChevronRight size={16} />
        </button>
        <small>Single-host monitoring · Credentials stay on the server</small>
      </form>
    </main>
  );
}
function App() {
  const [token, setToken] = useState(
    () => sessionStorage.getItem("opsdeck.token") || "",
  );
  const [page, setPage] = useState("overview");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [history, setHistory] = useState<History[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [hours, setHours] = useState(1);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [query, setQuery] = useState("");
  const [containerFilter, setContainerFilter] = useState("all");
  const [showVirtualNetwork, setShowVirtualNetwork] = useState(false);
  const [jobFilter, setJobFilter] = useState("all");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    let active = true;
    async function load() {
      try {
        const [s, h, e] = await Promise.all([
          api<Snapshot>("snapshot", token, undefined, controller.signal),
          api<History[]>(
            `history?hours=${hours}`,
            token,
            undefined,
            controller.signal,
          ),
          api<Event[]>("events", token, undefined, controller.signal),
        ]);
        if (active) {
          setSnapshot(s);
          setHistory(h);
          setEvents(e);
          setError("");
        }
      } catch (err) {
        if (active) setError((err as Error).message);
      }
    }
    void load();
    const timer = window.setInterval(load, 10000);
    return () => {
      active = false;
      controller.abort();
      clearInterval(timer);
    };
  }, [token, hours, refresh]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 8000);
    return () => clearTimeout(t);
  }, [toast]);
  function signOut() {
    sessionStorage.removeItem("opsdeck.token");
    setToken("");
    setSnapshot(null);
    setHistory([]);
    setEvents([]);
    setError("");
    setPlan(null);
  }
  if (!token)
    return (
      <SignIn
        onSignIn={(t) => {
          sessionStorage.setItem("opsdeck.token", t);
          setToken(t);
        }}
      />
    );
  const sources = snapshot?.sources || {};
  const host = sources.host?.data;
  const docker = sources.docker?.data;
  const gitlab = sources.gitlab?.data;
  const gpu = sources.gpu?.data?.[0];
  const containers: any[] = docker?.containers || [];
  const jobs: any[] = gitlab?.jobs || [];
  const pipelines: any[] = gitlab?.pipelines || [];
  const alerts = snapshot?.alerts || [];
  const connected = Object.values(sources).filter(
    (s) => s.status === "healthy" && !s.stale,
  ).length;
  const title = pages.find((p) => p.id === page)?.title || "Overview";
  const latest = sources.host?.updated_at;
  const ciKnown = sources.gitlab?.status === "healthy";
  const filteredContainers = containers.filter(
    (c) =>
      `${c.name} ${c.image}`.toLowerCase().includes(query.toLowerCase()) &&
      (containerFilter === "all" || c.state === containerFilter),
  );
  const runnerMetrics = sources.runner?.data?.metrics || {};
  async function previewAction(action: string, target: string) {
    setBusy(true);
    setActionError("");
    try {
      setPlan(await api<Plan>("actions/preview", token, { action, target }));
      setConfirmation("");
    } catch (err) {
      setToast((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const exportSnapshot = () =>
    download(
      "opsdeck-snapshot.json",
      JSON.stringify(snapshot, null, 2),
      "application/json",
    );
  const stats = (
    <div className="resource-strip">
      <div>
        <div className="stat-label">
          <Cpu size={17} />
          CPU utilization
        </div>
        <strong>{pct(host?.cpu.percent)}</strong>
        <Meter value={host?.cpu.percent} />
        <small>
          {host
            ? `${host.cpu.cores} cores / ${host.cpu.threads} threads`
            : "Waiting for host data"}
        </small>
      </div>
      <div>
        <div className="stat-label">
          <MemoryStick size={17} />
          Memory
        </div>
        <strong>{pct(host?.memory.percent)}</strong>
        <Meter value={host?.memory.percent} color="purple" />
        <small>
          {host
            ? `${bytes(host.memory.available)} available`
            : "Waiting for host data"}
        </small>
      </div>
      <div>
        <div className="stat-label">
          <Zap size={17} />
          GPU utilization
        </div>
        <strong>{pct(gpu?.utilization)}</strong>
        <Meter value={gpu?.utilization} color="teal" />
        <small>
          {gpu
            ? `${bytes(gpu.memory_used_mib * 1024 ** 2)} / ${bytes(gpu.memory_total_mib * 1024 ** 2)} VRAM`
            : sources.gpu?.status === "not_configured"
              ? "No NVIDIA integration"
              : "GPU data unavailable"}
        </small>
      </div>
      <div>
        <div className="stat-label">
          <GitBranch size={17} />
          CI containers
        </div>
        <strong>
          {sources.docker?.status === "healthy"
            ? (docker?.ci_running ?? 0)
            : "—"}
          <span className="stat-unit"> running</span>
        </strong>
        <small>
          Build, helper, and service containers identified on this host
        </small>
        <button className="text-button" onClick={() => setPage("gitlab")}>
          View runner stack <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
  return (
    <div className="workspace">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setPage("overview");
          }}
        >
          <Gauge size={28} />
          <span>OpsDeck</span>
        </a>
        <div className="workspace-label">Infrastructure workspace</div>
        <nav aria-label="Main navigation">
          {pages.map((p) => (
            <button
              key={p.id}
              aria-label={p.title}
              aria-current={page === p.id ? "page" : undefined}
              className={page === p.id ? "active" : ""}
              onClick={() => {
                setPage(p.id);
                setQuery("");
              }}
            >
              <p.icon size={18} />
              {p.title}
              {p.id === "activity" && alerts.length > 0 && (
                <span className="nav-count">{alerts.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="host-chip">
            <span className="status-dot" />
            <div>
              <strong>{host?.hostname || "Connecting to host"}</strong>
              <small>
                {connected}/{Object.keys(sources).length || 5} integrations
                available
              </small>
            </div>
          </div>
          <button onClick={signOut}>
            <LogOut size={16} />
            Sign out
          </button>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <span>
            <Server size={15} />
            Single-host workspace
          </span>
          <div>
            <span className={`live ${error ? "offline" : ""}`}>
              <i />
              {error
                ? "Connection issue"
                : snapshot
                  ? "Auto refresh · 10s"
                  : "Connecting"}
            </span>
            <button
              className="icon-button"
              aria-label="Refresh metrics"
              onClick={() => setRefresh((v) => v + 1)}
            >
              <RefreshCw size={17} />
            </button>
            <button
              className="icon-button"
              aria-label="Sign out"
              onClick={signOut}
            >
              <LogOut size={16} />
            </button>
          </div>
        </header>
        <main className="content">
          <div className="page-heading">
            <div>
              <h1>{title}</h1>
              <p>
                {page === "overview"
                  ? "A live picture of capacity, workloads, and what needs attention."
                  : page === "optimization"
                    ? "Measured opportunities and the next step for each resource."
                    : page === "connections"
                      ? "Know what is connected, how fresh it is, and what to configure."
                      : "Inspect the details behind your infrastructure."}
              </p>
            </div>
            <button
              className="secondary"
              onClick={exportSnapshot}
              disabled={!snapshot}
            >
              <Download size={16} />
              Export snapshot
            </button>
          </div>
          {error && (
            <div className="notice error" role="alert">
              <TriangleAlert size={18} />
              <div>
                <strong>Refresh failed</strong>
                <p>{error} Existing values are the last successful snapshot.</p>
                <button
                  className="text-button"
                  onClick={() => setRefresh((v) => v + 1)}
                >
                  Retry
                </button>
              </div>
            </div>
          )}
          {snapshot?.history_error && (
            <div className="notice error" role="alert">
              {snapshot.history_error}
            </div>
          )}
          {!snapshot && !error && (
            <Empty
              title="Connecting to your infrastructure"
              text="Collectors run independently. Your first host sample will appear shortly."
            />
          )}
          {page === "overview" && (
            <>
              <SourceNotice source={sources.host} name="Host" />
              {host?.scope === "container" && (
                <div className="notice">
                  <Server size={18} />
                  <div>
                    <strong>Container view</strong>
                    <p>
                      Full node monitoring is not enabled. Use the Linux host
                      configuration to see the node's filesystems, processes,
                      and interfaces.
                    </p>
                  </div>
                </div>
              )}
              {stats}
              <div className="two-column overview-columns">
                <Panel
                  title="Capacity over time"
                  note={
                    <select
                      aria-label="History range"
                      value={hours}
                      onChange={(e) => setHours(Number(e.target.value))}
                    >
                      <option value={1}>Last hour</option>
                      <option value={6}>Last 6 hours</option>
                      <option value={24}>Last 24 hours</option>
                      <option value={168}>Last 7 days</option>
                      <option value={720}>Last 30 days</option>
                    </select>
                  }
                >
                  <Chart
                    history={history}
                    keys={[
                      ["cpu", "CPU", "#3169c6"],
                      ["memory", "Memory", "#8768b1"],
                      ["gpu", "GPU 0", "#14857f"],
                    ]}
                  />
                </Panel>
                <Panel title="Needs attention" note={`${alerts.length} active`}>
                  <div className="attention">
                    {alerts.length ? (
                      alerts.slice(0, 5).map((a) => (
                        <div key={a.key}>
                          <TriangleAlert size={18} />
                          <strong>{a.title}</strong>
                          <p>{a.detail}</p>
                        </div>
                      ))
                    ) : (
                      <div>
                        <Check size={22} />
                        <strong>No threshold alerts in available data</strong>
                        <p>
                          Unavailable integrations cannot be evaluated. Check
                          connection coverage below.
                        </p>
                      </div>
                    )}
                  </div>
                  <button
                    className="text-button panel-link"
                    onClick={() => setPage("activity")}
                  >
                    Open activity <ChevronRight size={14} />
                  </button>
                </Panel>
              </div>
              <div className="two-column">
                <Panel title="Integration coverage">
                  <div className="source-list">
                    {Object.entries(sources).map(([key, value]) => (
                      <button key={key} onClick={() => setPage("connections")}>
                        <span>
                          {
                            (
                              {
                                host: "Host resources",
                                docker: "Docker engine",
                                gpu: "NVIDIA GPU",
                                runner: "GitLab runner",
                                gitlab: "GitLab projects",
                                services: "System services",
                                findings: "Survey archive",
                              } as Record<string, string>
                            )[key]
                          }
                        </span>
                        <Badge value={value.stale ? "stale" : value.status} />
                        <ChevronRight size={15} />
                      </button>
                    ))}
                  </div>
                </Panel>
                <Panel title="Storage headroom">
                  {host?.volumes?.length ? (
                    host.volumes.slice(0, 4).map((v: any) => (
                      <div className="volume" key={v.mount}>
                        <div>
                          <strong>{v.mount}</strong>
                          <span>
                            {bytes(v.free)} free of {bytes(v.total)}
                          </span>
                        </div>
                        <Meter
                          value={v.percent}
                          color={v.percent > 85 ? "red" : "blue"}
                        />
                        <small>
                          {v.device} · {v.fstype} · {pct(v.percent)} used
                        </small>
                      </div>
                    ))
                  ) : (
                    <Empty
                      title="No filesystem data yet"
                      text="Check the host collector connection."
                    />
                  )}
                </Panel>
              </div>
            </>
          )}
          {page === "host" && (
            <>
              <SourceNotice source={sources.host} name="Host" />
              {host?.scope === "container" && (
                <div className="notice">
                  <Server size={18} />
                  <div>
                    <strong>Container view</strong>
                    <p>
                      Full node monitoring is not enabled. Use the Linux host
                      configuration to see the node's filesystems, processes,
                      and interfaces.
                    </p>
                  </div>
                </div>
              )}
              {stats}
              <div className="two-column">
                <Panel title="Host facts">
                  <dl className="facts">
                    <dt>Hostname</dt>
                    <dd>{host?.hostname || "—"}</dd>
                    <dt>Collection scope</dt>
                    <dd>
                      {host?.scope === "host"
                        ? "Linux node"
                        : host?.scope === "native"
                          ? "Native node"
                          : host?.scope === "container"
                            ? "Container view"
                            : "—"}
                    </dd>
                    <dt>Operating system</dt>
                    <dd>{host?.os || "—"}</dd>
                    <dt>Uptime</dt>
                    <dd>
                      {host
                        ? duration(snapshot!.server_time - host.boot_time)
                        : "—"}
                    </dd>
                    <dt>Load average (1 / 5 / 15m)</dt>
                    <dd>
                      {host?.cpu.load
                        .map((n: number) => n.toFixed(2))
                        .join(" / ") || "—"}
                    </dd>
                    <dt>CPU frequency</dt>
                    <dd>
                      {host?.cpu.mhz ? `${Math.round(host.cpu.mhz)} MHz` : "—"}
                    </dd>
                    <dt>Processes</dt>
                    <dd>{host?.processes ?? "—"}</dd>
                    <dt>Swap used</dt>
                    <dd>
                      {bytes(host?.memory.swap_used)} /{" "}
                      {bytes(host?.memory.swap_total)}
                    </dd>
                    <dt>Page cache</dt>
                    <dd>{bytes(host?.memory.cached)}</dd>
                  </dl>
                </Panel>
                <Panel
                  title="Pressure stalls"
                  note="Tasks waiting, last minute"
                >
                  <p className="panel-description">
                    Pressure shows time spent waiting for a resource. Low
                    utilization can coexist with high storage pressure.
                  </p>
                  {["cpu", "memory", "io"].map((key) => (
                    <div className="pressure-row" key={key}>
                      <span>
                        {
                          (
                            {
                              cpu: "CPU",
                              memory: "Memory",
                              io: "Storage I/O",
                            } as Record<string, string>
                          )[key]
                        }
                      </span>
                      <Meter value={host?.pressure?.[key]?.some?.avg60} />
                      <strong>{pct(host?.pressure?.[key]?.some?.avg60)}</strong>
                    </div>
                  ))}
                </Panel>
              </div>
              <Panel title="Filesystem capacity">
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Mount</th>
                        <th>Device</th>
                        <th>Capacity</th>
                        <th>Available</th>
                        <th>Usage</th>
                        <th>Inodes used</th>
                      </tr>
                    </thead>
                    <tbody>
                      {host?.volumes?.map((v: any) => (
                        <tr key={v.mount}>
                          <td>
                            <strong>{v.mount}</strong>
                            <small>{v.fstype}</small>
                          </td>
                          <td>{v.device}</td>
                          <td>{bytes(v.total)}</td>
                          <td>{bytes(v.free)}</td>
                          <td>
                            <Meter value={v.percent} />
                            {pct(v.percent)}
                          </td>
                          <td>{pct(v.inode_percent)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>
              <Panel title="Device inventory">
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Device</th>
                        <th>Capacity</th>
                        <th>Media</th>
                        <th>Filesystem / partitions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {host?.inventory?.map((d: any) => (
                        <tr key={d.name}>
                          <td>{d.name}</td>
                          <td>{bytes(d.size)}</td>
                          <td>{d.rota ? "HDD" : "Solid state"}</td>
                          <td>
                            {d.fstype ||
                              (d.children?.length
                                ? `${d.children.length} partition(s)`
                                : "No filesystem reported")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="panel-description">
                  Device ownership and contents must be checked separately
                  before repurposing a drive.
                </p>
              </Panel>
              <Panel title="Physical disks & I/O">
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Device</th>
                        <th>Read / write</th>
                        <th>Operations/s</th>
                        <th>Average latency</th>
                        <th>Busy</th>
                      </tr>
                    </thead>
                    <tbody>
                      {host?.disks?.map((d: any) => (
                        <tr key={d.name}>
                          <td>{d.name}</td>
                          <td>
                            {bytes(d.read_bytes_s)}/s / {bytes(d.write_bytes_s)}
                            /s
                          </td>
                          <td>{d.iops?.toFixed(1) ?? "—"}</td>
                          <td>
                            {d.await_ms == null
                              ? "—"
                              : `${d.await_ms.toFixed(1)} ms`}
                          </td>
                          <td>{pct(d.busy_percent)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="panel-description">
                  Rates need two samples. Device busy time alone does not
                  measure NVMe saturation.
                </p>
              </Panel>
              <div className="two-column">
                <Panel
                  title="Network interfaces"
                  note={
                    <button
                      className="text-button"
                      onClick={() => setShowVirtualNetwork((v) => !v)}
                    >
                      {showVirtualNetwork
                        ? "Hide virtual interfaces"
                        : "Show virtual interfaces"}
                    </button>
                  }
                >
                  {host?.network
                    ?.filter(
                      (n: any) =>
                        showVirtualNetwork ||
                        !/^(docker|veth|br-)/.test(n.name),
                    )
                    .map((n: any) => (
                      <div className="network-row" key={n.name}>
                        <Network size={17} />
                        <div>
                          <strong>{n.name}</strong>
                          <small>
                            {n.up ? "Up" : "Down"} ·{" "}
                            {n.speed_mbps > 0
                              ? `${n.speed_mbps} Mbps`
                              : "Link speed unavailable"}{" "}
                            · {n.errors} errors / {n.drops} drops
                          </small>
                        </div>
                        <span>
                          <ArrowDown size={13} />
                          {bytes(n.rx_bytes_s)}/s
                          <br />
                          <ArrowUp size={13} />
                          {bytes(n.tx_bytes_s)}/s
                        </span>
                      </div>
                    ))}
                </Panel>
                <Panel title="GPU & temperatures">
                  <SourceNotice source={sources.gpu} name="GPU" />
                  {sources.gpu?.data?.map((g: any) => (
                    <div className="gpu" key={g.index}>
                      <h3>{g.name}</h3>
                      <dl className="facts">
                        <dt>GPU utilization</dt>
                        <dd>{pct(g.utilization)}</dd>
                        <dt>VRAM</dt>
                        <dd>
                          {g.memory_used_mib} / {g.memory_total_mib} MiB
                        </dd>
                        <dt>Temperature</dt>
                        <dd>{g.temperature ?? "—"} °C</dd>
                        <dt>Power draw / limit</dt>
                        <dd>
                          {g.power_w ?? "—"} / {g.power_limit_w ?? "—"} W
                        </dd>
                        <dt>Driver</dt>
                        <dd>{g.driver}</dd>
                      </dl>
                    </div>
                  ))}
                  <div className="temperature-list">
                    {host?.temperatures
                      ?.slice(0, 8)
                      .map((t: any, i: number) => (
                        <span key={i}>
                          <Thermometer size={13} />
                          {t.label || t.sensor}: {t.current} °C
                        </span>
                      ))}
                  </div>
                </Panel>
              </div>
            </>
          )}
          {page === "host" && (
            <>
              <Panel title="System services">
                <SourceNotice source={sources.services} name="Services" />
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Service</th>
                        <th>State</th>
                        <th>Detail</th>
                        <th>Memory</th>
                        <th>Exit code</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sources.services?.data?.map((s: any) => (
                        <tr key={s.name}>
                          <td>{s.name}</td>
                          <td>
                            <Badge value={s.state} />
                          </td>
                          <td>
                            {s.load === "not-found"
                              ? "Not installed"
                              : s.substate}
                          </td>
                          <td>{bytes(s.memory_bytes)}</td>
                          <td>{s.exit_code ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>
              <Panel title="Processes with the largest memory footprint">
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Process</th>
                        <th>PID</th>
                        <th>Resident memory</th>
                        <th>CPU</th>
                      </tr>
                    </thead>
                    <tbody>
                      {host?.top_processes?.map((p: any) => (
                        <tr key={p.pid}>
                          <td>{p.name}</td>
                          <td>{p.pid}</td>
                          <td>{bytes(p.memory_bytes)}</td>
                          <td>{pct(p.cpu_percent)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="panel-description">
                  Top 15 by resident memory. Process CPU needs two samples.
                  Arguments and environment variables are not collected.
                </p>
              </Panel>
            </>
          )}
          {page === "docker" && (
            <>
              <SourceNotice source={sources.docker} name="Docker" />
              <div className="summary-row">
                <div>
                  <Box />
                  <strong>{docker?.total_containers ?? "—"}</strong>
                  <span>Containers</span>
                </div>
                <div>
                  <Activity />
                  <strong>
                    {docker
                      ? containers.filter((c) => c.state === "running").length
                      : "—"}
                  </strong>
                  <span>Running in inventory</span>
                </div>
                <div>
                  <HardDrive />
                  <strong>{bytes(docker?.storage?.layers_bytes)}</strong>
                  <span>Image layers</span>
                </div>
                <div>
                  <RefreshCw />
                  <strong>
                    {bytes(docker?.storage?.build_cache_reclaimable_bytes)}
                  </strong>
                  <span>Reclaimable build cache</span>
                </div>
              </div>
              <Panel
                title="Container inventory"
                note={
                  docker
                    ? `Engine ${docker.version} · ${docker.storage_driver}`
                    : undefined
                }
              >
                <div className="table-toolbar">
                  <label className="search">
                    <Search size={16} />
                    <input
                      aria-label="Search containers"
                      placeholder="Search containers or images"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </label>
                  <select
                    aria-label="Container state"
                    value={containerFilter}
                    onChange={(e) => setContainerFilter(e.target.value)}
                  >
                    <option value="all">All states</option>
                    <option value="running">Running</option>
                    <option value="exited">Exited</option>
                  </select>
                </div>
                {filteredContainers.length ? (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Container</th>
                          <th>State</th>
                          <th>CPU</th>
                          <th>Memory</th>
                          <th>Ownership</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredContainers.map((c) => (
                          <tr key={c.id}>
                            <td>
                              <strong>{c.name}</strong>
                              <small>{c.image}</small>
                            </td>
                            <td>
                              <Badge value={c.state} />
                              <small>{c.status}</small>
                            </td>
                            <td>{pct(c.cpu_percent)}</td>
                            <td>
                              {bytes(c.memory_bytes)}
                              <small>Limit {bytes(c.memory_limit)}</small>
                            </td>
                            <td>
                              {c.ci
                                ? "CI job"
                                : c.managed
                                  ? "Managed"
                                  : "Observe only"}
                            </td>
                            <td>
                              {snapshot?.actions_enabled &&
                              c.managed &&
                              !c.ci &&
                              c.state === "running" ? (
                                <div className="inline-actions">
                                  <button
                                    disabled={busy}
                                    onClick={() =>
                                      previewAction("restart", c.id)
                                    }
                                  >
                                    Restart
                                  </button>
                                  <button
                                    disabled={busy}
                                    onClick={() => previewAction("stop", c.id)}
                                  >
                                    Stop
                                  </button>
                                </div>
                              ) : (
                                "—"
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <Empty
                    title={
                      query ? "No containers match" : "No containers to display"
                    }
                    text={
                      query
                        ? "Try another name or change the state filter."
                        : "The engine may be idle or unavailable. Check the Docker connection."
                    }
                  />
                )}
                <p className="panel-description">
                  Container CPU can exceed 100% when using multiple cores. CPU
                  rates need two samples. Stats cover up to 64 running
                  containers; inventory is capped at 200.
                </p>
              </Panel>
              <div className="notice">
                <ShieldCheck size={18} />
                <div>
                  <strong>
                    {snapshot?.actions_enabled
                      ? "Actions are enabled for opted-in containers"
                      : "Actions are disabled"}
                  </strong>
                  <p>
                    Restart and stop require the managed label, an explicit
                    preview, and typed confirmation. CI containers are excluded.
                    Every attempted execution is audited.
                  </p>
                </div>
              </div>
            </>
          )}
          {page === "survey" && <SurveyPage source={sources.findings} />}
          {page === "optimization" && (
            <RecordedOptimizations archive={sources.findings?.data} />
          )}
          {page === "gitlab" && (
            <>
              <SourceNotice source={sources.docker} name="Docker" />
              <SourceNotice source={sources.runner} name="Runner telemetry" />
              <RunnerInventory
                docker={docker}
                archive={sources.findings?.data}
                host={host}
              />
            </>
          )}
          {page === "gitlab" &&
            sources.gitlab?.status !== "not_configured" &&
            sources.gitlab?.status !== "collecting" && (
              <>
                <SourceNotice source={sources.gitlab} name="GitLab" />
                <SourceNotice source={sources.runner} name="Runner" />
                <div className="summary-row">
                  <div>
                    <GitBranch />
                    <strong>
                      {ciKnown
                        ? pipelines.filter((p) => p.status === "running").length
                        : "—"}
                    </strong>
                    <span>Running pipelines</span>
                  </div>
                  <div>
                    <Activity />
                    <strong>
                      {ciKnown
                        ? jobs.filter((j) => j.status === "pending").length
                        : "—"}
                    </strong>
                    <span>Pending jobs in sample</span>
                  </div>
                  <div>
                    <Cpu />
                    <strong>
                      {runnerMetrics.gitlab_runner_concurrent ??
                        sources.runner?.data?.facts?.concurrent ??
                        "—"}
                    </strong>
                    <span>Configured runner slots</span>
                  </div>
                  <div>
                    <Server />
                    <strong>{gitlab?.projects?.length ?? "—"}</strong>
                    <span>Connected projects</span>
                  </div>
                </div>
                <Panel
                  title="Recent & active pipelines"
                  note="GitLab is read-only"
                >
                  {pipelines.length ? (
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Pipeline / project</th>
                            <th>Branch</th>
                            <th>Status</th>
                            <th>Duration</th>
                            <th>Queue duration</th>
                            <th>Created</th>
                          </tr>
                        </thead>
                        <tbody>
                          {pipelines.map((p) => (
                            <tr key={`${p.project}-${p.id}`}>
                              <td>
                                <a
                                  href={safeUrl(p.url)}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  #{p.id}
                                  <ExternalLink size={12} />
                                </a>
                                <small>{p.project}</small>
                              </td>
                              <td>{p.ref}</td>
                              <td>
                                <Badge value={p.status} />
                              </td>
                              <td>{duration(p.duration)}</td>
                              <td>{duration(p.queued_duration)}</td>
                              <td>
                                {p.created_at
                                  ? new Date(p.created_at).toLocaleString()
                                  : "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <Empty
                      title="Connect your projects"
                      text="Configure a read_api GitLab token and project IDs on the server. No GitLab credentials are stored in this browser."
                    />
                  )}
                </Panel>
                <Panel title="Jobs in selected pipelines">
                  <div className="table-toolbar">
                    <label className="search">
                      <Search size={16} />
                      <input
                        aria-label="Search jobs"
                        placeholder="Search jobs or projects"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                    </label>
                    <select
                      aria-label="Job status"
                      value={jobFilter}
                      onChange={(e) => setJobFilter(e.target.value)}
                    >
                      <option value="all">All statuses</option>
                      <option value="pending">Pending</option>
                      <option value="running">Running</option>
                      <option value="failed">Failed</option>
                      <option value="success">Success</option>
                    </select>
                  </div>
                  {jobs.length ? (
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Job</th>
                            <th>Pipeline</th>
                            <th>Status</th>
                            <th>Execution</th>
                            <th>Queue</th>
                            <th>Runner</th>
                          </tr>
                        </thead>
                        <tbody>
                          {jobs
                            .filter(
                              (j) =>
                                `${j.name} ${j.project}`
                                  .toLowerCase()
                                  .includes(query.toLowerCase()) &&
                                (jobFilter === "all" || j.status === jobFilter),
                            )
                            .map((j) => (
                              <tr key={`${j.project}-${j.id}`}>
                                <td>
                                  <a
                                    href={safeUrl(j.url)}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    {j.name}
                                    <ExternalLink size={12} />
                                  </a>
                                  <small>{j.project}</small>
                                </td>
                                <td>#{j.pipeline}</td>
                                <td>
                                  <Badge value={j.status} />
                                </td>
                                <td>{duration(j.duration)}</td>
                                <td>{duration(j.queued_duration)}</td>
                                <td>{j.runner || "Unassigned"}</td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <Empty
                      title="No jobs collected"
                      text="Jobs are collected from active pipelines and the newest pipeline per configured project."
                    />
                  )}
                  <p className="panel-description">
                    {gitlab?.scope ||
                      "Recent and active pipelines are sampled every 60 seconds."}{" "}
                    Queue and duration fields remain empty when GitLab does not
                    provide them.
                  </p>
                </Panel>
                <Panel title="Runner configuration & telemetry">
                  {sources.runner?.data?.facts?.runners?.length ? (
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Registration</th>
                            <th>Executor</th>
                            <th>Job limit</th>
                            <th>Request concurrency</th>
                            <th>CPU quota</th>
                            <th>Memory ceiling</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sources.runner.data.facts.runners.map((r: any) => (
                            <tr key={r.name}>
                              <td>{r.name}</td>
                              <td>{r.executor}</td>
                              <td>
                                {r.limit === 0 ? "Global limit" : r.limit}
                              </td>
                              <td>{r.request_concurrency}</td>
                              <td>{r.cpus ?? "Not set"}</td>
                              <td>{r.memory ?? "Not set"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="panel-description">
                      Export sanitized runner facts with the administrator
                      helper to inspect each registration's worker budget.
                    </p>
                  )}
                  {Object.keys(runnerMetrics).length > 0 && (
                    <details className="runner-details">
                      <summary>Inspect runner measurements</summary>
                      <div className="table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th>Measurement</th>
                              <th>Value</th>
                            </tr>
                          </thead>
                          <tbody>
                            {Object.entries(runnerMetrics)
                              .filter(([k]) => !k.endsWith("_bucket"))
                              .slice(0, 50)
                              .map(([key, value]) => (
                                <tr key={key}>
                                  <td>{key}</td>
                                  <td>{Number(value).toLocaleString()}</td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      </div>
                      <p className="panel-description">
                        Series are summed across runner labels. Counters are
                        cumulative; these are not rates or queue latency
                        estimates.
                      </p>
                    </details>
                  )}
                </Panel>
              </>
            )}
          {page === "optimization" && (
            <>
              <div className="optimization-intro">
                <SlidersHorizontal size={25} />
                <div>
                  <h2>Turn available capacity into useful work</h2>
                  <p>
                    Each recommendation shows its evidence. Verification and
                    administrator steps stay explicit; no changes are applied
                    automatically.
                  </p>
                </div>
              </div>
              <div className="recommendations">
                {snapshot?.recommendations.map((r) => (
                  <article className="recommendation" key={r.key}>
                    <div>
                      <span className="category">{r.category}</span>
                      <Badge value={r.status} />
                    </div>
                    <h2>{r.title}</h2>
                    <p>{r.evidence}</p>
                    <div className="next-step">
                      <strong>Next step</strong>
                      <p>{r.next}</p>
                    </div>
                  </article>
                ))}
              </div>
              <Panel title="Measure before raising concurrency">
                <div className="benchmark">
                  <div>
                    <strong>Baseline</strong>
                    <p>
                      Record warm and cold job times, queue time, and completed
                      pipelines per hour.
                    </p>
                  </div>
                  <ChevronRight />
                  <div>
                    <strong>Change one resource</strong>
                    <p>
                      Move storage or adjust worker budgets, then repeat the
                      same workload.
                    </p>
                  </div>
                  <ChevronRight />
                  <div>
                    <strong>Keep the useful change</strong>
                    <p>
                      Compare throughput and p95 latency. Stop increasing slots
                      when contention makes jobs slower.
                    </p>
                  </div>
                </div>
              </Panel>
            </>
          )}
          {page === "activity" && (
            <>
              <Panel title="Active conditions" note={`${alerts.length} active`}>
                {alerts.length ? (
                  <div className="event-list">
                    {alerts.map((a) => (
                      <div key={a.key}>
                        <TriangleAlert size={18} />
                        <div>
                          <strong>{a.title}</strong>
                          <p>{a.detail}</p>
                        </div>
                        <Badge value={a.severity} />
                      </div>
                    ))}
                  </div>
                ) : (
                  <Empty
                    title="No active threshold alerts"
                    text="Thresholds cover available filesystem, inode, memory, GPU temperature, Docker health, storage pressure, and sampled CI queue data."
                  />
                )}
              </Panel>
              <Panel
                title="Event & action history"
                note="Most recent 100 events"
              >
                {events.length ? (
                  <div className="event-list">
                    {events.map((e) => (
                      <div key={e.id}>
                        {e.kind === "action" ? (
                          <ShieldCheck size={18} />
                        ) : (
                          <Activity size={18} />
                        )}
                        <div>
                          <strong>{e.title}</strong>
                          <p>{e.detail}</p>
                          <small>
                            {new Date(e.ts * 1000).toLocaleString()} · {e.kind}
                          </small>
                        </div>
                        <Badge value={e.severity} />
                      </div>
                    ))}
                  </div>
                ) : (
                  <Empty
                    title="Your audit trail starts here"
                    text="New threshold alerts, cleared conditions, and action executions appear as they happen."
                  />
                )}
              </Panel>
            </>
          )}
          {page === "connections" && (
            <>
              <div className="connection-grid">
                {Object.entries(sources).map(([key, s]) => (
                  <Panel
                    key={key}
                    title={
                      key === "gpu"
                        ? "NVIDIA GPU"
                        : key === "gitlab"
                          ? "GitLab projects"
                          : key === "runner"
                            ? "GitLab runner"
                            : key === "docker"
                              ? "Docker engine"
                              : key === "findings"
                                ? "Survey archive"
                                : key === "services"
                                  ? "System services"
                                  : "Host resources"
                    }
                    note={<Badge value={s.stale ? "stale" : s.status} />}
                  >
                    <p className="panel-description">
                      {s.message || "Collector connected and reporting."}
                    </p>
                    <dl className="facts">
                      <dt>Last collector attempt</dt>
                      <dd>
                        {s.updated_at
                          ? new Date(s.updated_at * 1000).toLocaleTimeString()
                          : "Waiting"}
                      </dd>
                      <dt>Sample age</dt>
                      <dd>{duration(s.age_seconds)}</dd>
                    </dl>
                  </Panel>
                ))}
              </div>
              <Panel title="Server configuration guide">
                <div className="setup-guide">
                  <article>
                    <h3>GitLab</h3>
                    <p>
                      Set <code>GITLAB_URL</code>, <code>GITLAB_TOKEN</code>{" "}
                      with read_api scope, and comma-separated{" "}
                      <code>GITLAB_PROJECT_IDS</code>. Restart OpsDeck after
                      updating its environment file.
                    </p>
                  </article>
                  <article>
                    <h3>Runner</h3>
                    <p>
                      Enable the runner's local metrics listener and set{" "}
                      <code>RUNNER_METRICS_URL</code>. The administrator script
                      exports safe runner facts without authentication tokens.
                    </p>
                  </article>
                  <article>
                    <h3>Docker & GPU</h3>
                    <p>
                      The service account needs Docker socket access. NVIDIA
                      metrics use the host's <code>nvidia-smi</code>. Missing
                      hardware or permissions appear as unavailable.
                    </p>
                  </article>
                  <article>
                    <h3>Actions & retention</h3>
                    <p>
                      Set <code>OPSDECK_ACTIONS=true</code> to permit
                      managed-container actions. Label eligible containers{" "}
                      <code>opsdeck.managed=true</code>. History retention:{" "}
                      {snapshot?.retention_days ?? "—"} days. Audit action
                      records are retained.
                    </p>
                  </article>
                </div>
              </Panel>
              <div className="notice">
                <ShieldCheck size={18} />
                <div>
                  <strong>Keep access private</strong>
                  <p>
                    Bind to localhost or your Tailscale address. Use HTTPS when
                    serving outside the private network. Tokens and environment
                    files never belong in GitHub.
                  </p>
                </div>
              </div>
            </>
          )}
          <footer>
            <span>
              OpsDeck {snapshot?.version || "0.1.0"} · Live data, explicit
              coverage
            </span>
            <span>
              {latest
                ? `Host sampled ${new Date(latest * 1000).toLocaleTimeString()}`
                : "Waiting for host sample"}{" "}
              · Charts show bucket averages
            </span>
          </footer>
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <span>{toast}</span>
          <button aria-label="Dismiss message" onClick={() => setToast("")}>
            <X size={16} />
          </button>
        </div>
      )}
      {plan && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="action-title"
            onKeyDown={(event) => {
              if (event.key === "Escape" && !busy) setPlan(null);
              if (event.key === "Tab") {
                const controls = Array.from(
                  event.currentTarget.querySelectorAll<HTMLElement>(
                    "button:not(:disabled), input:not(:disabled)",
                  ),
                );
                const first = controls[0],
                  last = controls[controls.length - 1];
                if (event.shiftKey && document.activeElement === first) {
                  event.preventDefault();
                  last?.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                  event.preventDefault();
                  first?.focus();
                }
              }
            }}
          >
            <button
              className="close icon-button"
              aria-label="Cancel action"
              onClick={() => {
                if (!busy) setPlan(null);
              }}
            >
              <X />
            </button>
            <TriangleAlert size={28} />
            <h2 id="action-title">Confirm {plan.action}</h2>
            <p>
              <strong>{plan.name}</strong>
            </p>
            <p>{plan.impact}</p>
            <p>
              This preview expires after 60 seconds. Type{" "}
              <code>{plan.confirmation}</code> to continue.
            </p>
            <label htmlFor="confirmation">Confirmation</label>
            <input
              id="confirmation"
              autoFocus
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              autoComplete="off"
            />
            {actionError && (
              <p className="error" role="alert">
                {actionError}
              </p>
            )}
            <div className="modal-actions">
              <button
                className="secondary"
                disabled={busy}
                onClick={() => setPlan(null)}
              >
                Cancel
              </button>
              <button
                className="danger"
                disabled={busy || confirmation !== plan.confirmation}
                onClick={async () => {
                  setBusy(true);
                  setActionError("");
                  try {
                    const result = await api<{ message: string }>(
                      "actions/execute",
                      token,
                      { nonce: plan.nonce, confirmation },
                    );
                    setToast(result.message);
                    setPlan(null);
                    setRefresh((v) => v + 1);
                  } catch (err) {
                    setActionError((err as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? "Applying…" : `Confirm ${plan.action}`}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
