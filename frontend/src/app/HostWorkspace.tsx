import { PaginatedList } from "../components/PaginatedList";
import { HostSwitcher } from "../components/HostSwitcher";
import { useHostApi } from "../lib/HostApi";
import { AppSidebar } from "../components/AppSidebar";
import { hostPages, hostPageGroups, hostPageId } from "./navigation";
import { SignIn } from "./SignIn";
import {
  SupportOverview,
  ResourceDiagnostics,
  PipelineDiagnostics,
} from "../features/diagnostics/Diagnostics";
import React, { useEffect, useState } from "react";
import {
  Activity,
  ClipboardList,
  ArrowDown,
  ArrowUp,
  Box,
  Check,
  ChevronRight,
  Cpu,
  Download,
  ExternalLink,
  GitBranch,
  HardDrive,
  LogOut,
  MemoryStick,
  Network,
  RefreshCw,
  Search,
  Server,
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
import { RunnerTelemetry } from "../features/runners/RunnerTelemetry";
import { OperatorConsole } from "../features/operations/OperatorConsole";
import { EventHistory } from "../features/operations/EventHistory";
import { Pager } from "../components/Pager";
import {
  useWorkloads,
  matchesScope,
  defaultScope,
  type Scope,
} from "../features/workloads/useWorkloads";
import {
  ScopeControls,
  WorkloadSummary,
} from "../features/workloads/ScopeControls";
import { WorkloadExplorer } from "../features/workloads/WorkloadExplorer";
import { LiveCheckpoints } from "../features/workloads/LiveCheckpoints";
import { GitLabSetup } from "../features/workloads/GitLabSetup";
import { Badge, tone } from "../components/Status";
import { ThemeToggle } from "../components/ThemeToggle";
import {
  activeDot,
  axisProps,
  chartTooltip,
  gapDots,
  gridProps,
} from "../components/chartTheme";
import { LiveIndicator } from "../components/LiveIndicator";
import { LoadingState, RequestProgress } from "../components/LoadingState";

function SourceNotice({ source, name }: { source?: Source; name: string }) {
  if (!source || (source.status === "healthy" && !source.stale)) return null;
  return (
    <div className={`notice ${tone(source.stale ? "stale" : source.status)}`}>
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
/** Usage bars keep their series color until a threshold turns them amber or red. */
function Meter({
  value,
  color = "blue",
  warnAt = 75,
  badAt = 90,
}: {
  value?: number | null;
  color?: string;
  warnAt?: number;
  badAt?: number;
}) {
  const level =
    value == null ? "" : value >= badAt ? "bad" : value >= warnAt ? "warn" : "";
  return (
    <div
      className={`meter ${level || color}`}
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
/** Compact empty state: one line of what is missing, one line of what to do. */
function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div className="empty">
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
  count = false,
  loading = false,
}: {
  history: History[];
  keys: Array<[string, string, string]>;
  percent?: boolean;
  count?: boolean;
  loading?: boolean;
}) {
  if (loading && !history.length)
    return (
      <LoadingState
        title="Loading history"
        detail="Retrieving retained resource samples."
        skeleton={false}
      />
    );
  if (history.length < 2)
    return (
      <Empty
        title="History is collecting"
        text="The first chart appears after two retained samples. Leave the collector running to build a timeline."
      />
    );
  const ChartType = percent ? AreaChart : LineChart;
  const time = (v: number) =>
    new Date(v * 1000).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  return (
    <div
      className="chart"
      aria-label={`Time series for ${keys.map((k) => k[1]).join(", ")}`}
    >
      <ResponsiveContainer width="100%" height={240}>
        <ChartType
          data={history}
          margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
        >
          <CartesianGrid {...gridProps} vertical={false} />
          <XAxis
            dataKey="ts"
            tickFormatter={time}
            minTickGap={60}
            {...axisProps}
          />
          <YAxis
            width={percent || count ? 44 : 72}
            domain={percent ? [0, 100] : [0, "auto"]}
            allowDecimals={!count}
            ticks={percent ? [0, 25, 50, 75, 100] : undefined}
            tickFormatter={(v) =>
              percent ? `${v}%` : count ? String(v) : bytes(v)
            }
            {...axisProps}
          />
          <Tooltip
            {...chartTooltip}
            labelFormatter={(v) => new Date(Number(v) * 1000).toLocaleString()}
            formatter={(v: any, name: any) => [
              percent
                ? pct(Number(v))
                : count
                  ? `${Number(v).toFixed(1)} jobs (bucket mean)`
                  : `${bytes(Number(v))}/s`,
              name,
            ]}
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
                fillOpacity={0.08}
                strokeWidth={1.75}
                dot={gapDots(history as any[], key, color)}
                activeDot={activeDot}
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
                dot={gapDots(history as any[], key, color)}
                activeDot={activeDot}
                strokeWidth={1.75}
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
export type FleetNavigation = {
  hosts: Array<{
    id: string;
    name: string;
    cluster: string;
    hostname?: string | null;
    status?: string;
  }>;
  selected: string;
  initialPage: string;
  onHost: (id: string) => void;
  onFleet: () => void;
  onEnroll: () => void;
  onAgent: () => void;
  onSignOut: () => void;
};
export function HostWorkspace({ fleet }: { fleet?: FleetNavigation }) {
  const { api } = useHostApi();
  const [token, setToken] = useState(
    () => sessionStorage.getItem("opsdeck.token") || "",
  );
  const [page, setPageState] = useState(() => hostPageId(fleet?.initialPage));
  function setPage(next: string) {
    setPageState(next);
    if (fleet) {
      const url = new URL(window.location.href);
      url.searchParams.set("section", next);
      window.history.replaceState(null, "", url);
    }
  }
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [history, setHistory] = useState<History[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [hours, setHours] = useState(1);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [query, setQuery] = useState("");
  const [containerRole, setContainerRole] = useState("all");
  const [containerSort, setContainerSort] = useState("name");
  const [containerPage, setContainerPage] = useState(1);
  const [containerFilter, setContainerFilter] = useState("all");
  const [showVirtualNetwork, setShowVirtualNetwork] = useState(false);
  const [jobFilter, setJobFilter] = useState("all");
  const [jobQuery, setJobQuery] = useState("");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [scope, setScope] = useState<Scope>(defaultScope);
  const workload = useWorkloads(token, scope, refresh);
  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    let active = true;
    let inFlight = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function load() {
      if (inFlight || !active) return;
      inFlight = true;
      setLoading(true);
      const results = await Promise.allSettled([
        api<Snapshot>("snapshot", token, undefined, controller.signal).then(
          (value) => {
            if (active) {
              setSnapshot(value);
              setUpdatedAt(Date.now());
            }
          },
        ),
        api<History[]>(
          `history?hours=${hours}`,
          token,
          undefined,
          controller.signal,
        ).then((value) => {
          if (active) setHistory(value);
        }),
        api<Event[]>("events", token, undefined, controller.signal).then(
          (value) => {
            if (active) setEvents(value);
          },
        ),
      ]);
      inFlight = false;
      if (!active) return;
      const failed = results.flatMap((result, index) =>
        result.status === "rejected"
          ? [
              `${["Host readings", "History", "Activity"][index]}: ${(result.reason as Error).message}`,
            ]
          : [],
      );
      setError(failed.join(" "));
      setLoading(false);
      failures = failed.length ? failures + 1 : 0;
      if (!document.hidden)
        timer = setTimeout(
          () => void load(),
          failures ? Math.min(60000, 5000 * 2 ** (failures - 1)) : 10000,
        );
    }
    function reconnect() {
      clearTimeout(timer);
      if (!document.hidden) void load();
    }
    function visibility() {
      if (document.hidden) clearTimeout(timer);
      else reconnect();
    }
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("online", reconnect);
    void load();
    return () => {
      active = false;
      controller.abort();
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("online", reconnect);
    };
  }, [api, token, hours, refresh]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 8000);
    return () => clearTimeout(t);
  }, [toast]);
  function signOut() {
    fleet?.onSignOut();
    sessionStorage.removeItem("opsdeck.token");
    setToken("");
    setSnapshot(null);
    setHistory([]);
    setEvents([]);
    setError("");
    setUpdatedAt(null);
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
  const allDocker = sources.docker?.data;
  const scoped =
    scope.project !== "all" ||
    scope.pipeline !== "all" ||
    scope.image !== "all";
  const scopedImages = new Set(
    (workload.data?.catalog.images || [])
      .filter(
        (image) =>
          (scope.project === "all" || image.projects.includes(scope.project)) &&
          (scope.pipeline === "all" ||
            image.pipelines.includes(scope.pipeline)) &&
          (scope.image === "all" || image.key === scope.image),
      )
      .map((image) => image.key),
  );
  const scopedContainers = (allDocker?.containers || []).filter((row: any) =>
    matchesScope(row, scope, workload.data),
  );
  const docker = allDocker
    ? {
        ...allDocker,
        containers: scoped ? scopedContainers : allDocker.containers,
        total_containers: scoped
          ? scopedContainers.length
          : allDocker.total_containers,
        ci_running: scoped
          ? scopedContainers.filter(
              (row: any) => row.ci && row.state === "running",
            ).length
          : allDocker.ci_running,
        images: scoped
          ? (allDocker.images || []).filter((row: any) =>
              scopedImages.has(row.id),
            )
          : allDocker.images,
        worker_history: (allDocker.worker_history || []).filter((row: any) =>
          matchesScope(row, scope, workload.data),
        ),
      }
    : allDocker;
  const archiveRepository = sources.findings?.data?.context?.repository;
  const archiveMatches =
    scope.project === "all" ||
    scope.project === archiveRepository ||
    workload.data?.catalog.projects.find(
      (project) => project.id === scope.project,
    )?.name === archiveRepository;
  const gitlab = sources.gitlab?.data;
  const gpu = sources.gpu?.data?.[0];
  const containers: any[] = docker?.containers || [];
  const selectedImage = workload.data?.catalog.images.find(
    (row) => row.key === scope.image,
  );
  const pipelineMatches = (row: any) => {
    const project = String(row.project_id || row.project);
    const key = `${project}:${row.pipeline ?? row.id}`;
    return (
      (scope.project === "all" ||
        scope.project === project ||
        scope.project === row.project) &&
      (scope.pipeline === "all" || scope.pipeline === key) &&
      (scope.image === "all" || selectedImage?.pipelines.includes(key))
    );
  };
  const jobs: any[] = (gitlab?.jobs || []).filter(pipelineMatches);
  const filteredJobs = jobs.filter(
    (j) =>
      `${j.name} ${j.project}`.toLowerCase().includes(jobQuery.toLowerCase()) &&
      (jobFilter === "all" || j.status === jobFilter),
  );
  const pipelines: any[] = (gitlab?.pipelines || []).filter(pipelineMatches);
  const alerts = snapshot?.alerts || [];
  const connected = Object.values(sources).filter(
    (s) => s.status === "healthy" && !s.stale,
  ).length;
  const current = hostPages.find((p) => p.id === page) || hostPages[0];
  const title = current.title;
  const latest = sources.host?.updated_at;
  const ciKnown = sources.gitlab?.status === "healthy";
  const filteredContainers = containers
    .filter(
      (c) =>
        `${c.name} ${c.image} ${c.id}`
          .toLowerCase()
          .includes(query.toLowerCase()) &&
        (containerFilter === "all" || c.state === containerFilter) &&
        (containerRole === "all" ||
          (containerRole === "ci"
            ? c.ci
            : containerRole === "managed"
              ? c.managed && !c.ci
              : !c.managed && !c.ci)),
    )
    .sort((a, b) =>
      containerSort === "cpu"
        ? (b.cpu_percent ?? -1) - (a.cpu_percent ?? -1)
        : containerSort === "memory"
          ? (b.memory_bytes ?? -1) - (a.memory_bytes ?? -1)
          : a.name.localeCompare(b.name),
    );
  const containerCurrentPage = Math.min(
    containerPage,
    Math.max(1, Math.ceil(filteredContainers.length / 20)),
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
      JSON.stringify(
        {
          ...snapshot,
          dashboard_scope: scope,
          workload_summary: workload.data?.summary,
        },
        null,
        2,
      ),
      "application/json",
    );
  const stats = (
    <div className="resource-strip">
      <div>
        <div className="stat-label">
          <Cpu size={17} />
          CPU utilization
        </div>
        <strong className={host ? undefined : "value-missing"}>
          {pct(host?.cpu.percent)}
        </strong>
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
        <strong className={host ? undefined : "value-missing"}>
          {pct(host?.memory.percent)}
        </strong>
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
        <strong className={gpu ? undefined : "value-missing"}>
          {pct(gpu?.utilization)}
        </strong>
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
            : "n/a"}
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
      <AppSidebar
        onHome={() => setPage("overview")}
        onSignOut={signOut}
        caption="Infrastructure workspace"
        footer={
          <>
            {" "}
            <div className="host-chip">
              <span
                className={`status-dot ${error ? "bad" : Object.values(sources).some((s) => s.stale || tone(s.status) === "bad") ? "warn" : "good"}`}
              />
              <div>
                <strong>{host?.hostname || "Connecting to host"}</strong>
                <small>
                  {connected}/{Object.keys(sources).length || 5} integrations
                  available
                </small>
              </div>
            </div>
          </>
        }
        groups={[
          ...(fleet
            ? [
                {
                  label: "Fleet",
                  items: [
                    {
                      id: "fleet",
                      label: "All hosts",
                      icon: Network,
                      onClick: fleet.onFleet,
                    },
                    {
                      id: "enroll",
                      label: "Enroll host",
                      icon: Server,
                      onClick: fleet.onEnroll,
                    },
                    {
                      id: "agent",
                      label: "Agent access",
                      icon: ShieldCheck,
                      onClick: fleet.onAgent,
                    },
                  ],
                },
              ]
            : []),
          ...hostPageGroups.map((group) => ({
            label: group,
            items: hostPages
              .filter((p) => p.group === group)
              .map((p) => ({
                id: p.id,
                label: p.title,
                icon: p.icon,
                active: page === p.id,
                alert: p.id === "activity",
                count:
                  p.id === "activity" && alerts.length
                    ? alerts.length
                    : undefined,
                onClick: () => {
                  setPage(p.id);
                  setQuery("");
                },
              })),
          })),
        ]}
      />
      <div className="main">
        <header className="topbar">
          {fleet ? (
            <HostSwitcher
              hosts={fleet.hosts}
              value={fleet.selected}
              onChange={fleet.onHost}
              allLabel={`All hosts (${fleet.hosts.length})`}
            />
          ) : (
            <HostSwitcher
              hosts={[
                {
                  id: "local",
                  name: host?.hostname || "This host",
                  cluster: "Local workspace",
                },
              ]}
              value="local"
              allLabel={
                snapshot?.fleet_url
                  ? "All hosts (open fleet)"
                  : "All hosts (fleet not configured)"
              }
              allDisabled={!safeUrl(snapshot?.fleet_url || undefined)}
              onChange={(id) => {
                const url = safeUrl(snapshot?.fleet_url || undefined);
                if (!id && url) window.location.assign(url);
              }}
            />
          )}
          <div className="topbar-tools">
            <LiveIndicator updatedAt={updatedAt} error={error || undefined} />
            <button
              className="icon-button"
              aria-label="Refresh metrics"
              title="Refresh now"
              disabled={loading}
              onClick={() => setRefresh((v) => v + 1)}
            >
              <RefreshCw
                size={16}
                className={loading ? "loading-spin" : undefined}
              />
            </button>
            <ThemeToggle />
            <span className="topbar-divider" aria-hidden="true" />
            <button
              className="icon-button"
              aria-label="Sign out"
              title="Sign out"
              onClick={signOut}
            >
              <LogOut size={16} />
            </button>
          </div>
          <RequestProgress />
        </header>
        <main className="content">
          <div className="page-heading">
            <div>
              <h1>{title}</h1>
              <p>{current.description}</p>
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
                <strong>
                  {snapshot
                    ? "Some data could not refresh"
                    : "Host data is unavailable"}
                </strong>
                <p>{error}</p>
                <p>
                  {snapshot
                    ? "Available readings are kept on screen. Failed sections retain their last values."
                    : "Check the host connection or open Agent access for retained observations."}{" "}
                  Updates will retry automatically.
                </p>
                <button
                  className="text-button"
                  disabled={loading}
                  onClick={() => setRefresh((v) => v + 1)}
                >
                  {loading ? "Reconnecting…" : "Retry now"}
                </button>
                {fleet && !snapshot && (
                  <button className="text-button" onClick={fleet.onAgent}>
                    Open Agent access
                  </button>
                )}
              </div>
            </div>
          )}
          {snapshot?.history_error && (
            <div className="notice error" role="alert">
              {snapshot.history_error}
            </div>
          )}
          {!snapshot && !error && <LoadingState />}
          {snapshot && current.scoped && (
            <ScopeControls
              scope={scope}
              setScope={setScope}
              view={workload.data}
              error={workload.error}
            />
          )}
          {snapshot && page === "projects" && (
            <PipelineDiagnostics
              pipelines={pipelines}
              jobs={jobs}
              fresh={ciKnown && !sources.gitlab?.stale}
            />
          )}
          {snapshot && page === "projects" && (
            <WorkloadExplorer
              onScope={setScope}
              token={token}
              scope={scope}
              view={workload.data}
              onRefresh={() => setRefresh((value) => value + 1)}
            />
          )}
          {snapshot && page === "overview" && (
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
              <WorkloadSummary view={workload.data} />
              {snapshot && (
                <SupportOverview snapshot={snapshot} onNavigate={setPage} />
              )}
              {stats}
              {sources.findings?.data && (
                <div className="notice info">
                  <ClipboardList size={18} />
                  <div>
                    <strong>Your runner speedup report</strong>
                    <p>
                      Compare the recorded baseline with optimization rounds,
                      see time saved and regressions, and check what is verified
                      on this host.
                    </p>
                    <button
                      className="text-button"
                      onClick={() => setPage("survey")}
                    >
                      Open speedup report <ChevronRight size={14} />
                    </button>
                  </div>
                </div>
              )}
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
                    loading={loading}
                    history={history}
                    keys={[
                      ["cpu", "CPU", "var(--series-1)"],
                      ["memory", "Memory", "var(--series-2)"],
                      ["gpu", "GPU 0", "var(--series-3)"],
                    ]}
                  />
                </Panel>
                <Panel title="Needs attention" note={`${alerts.length} active`}>
                  <div className="attention">
                    {alerts.length ? (
                      <PaginatedList
                        items={alerts as any[]}
                        label="Attention items"
                        initialSize={5}
                      >
                        {(pageRows) => (
                          <>
                            {pageRows.map((a) => (
                              <div key={a.key} className={tone(a.severity)}>
                                <TriangleAlert size={18} />
                                <strong>{a.title}</strong>
                                <p>{a.detail}</p>
                              </div>
                            ))}
                          </>
                        )}
                      </PaginatedList>
                    ) : (
                      <div className="good">
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
                  <PaginatedList
                    items={Object.entries(sources) as any[]}
                    label="Integration coverage"
                    initialSize={10}
                  >
                    {(pageRows) => (
                      <div className="source-list">
                        {pageRows.map(([key, value]) => (
                          <button
                            key={key}
                            onClick={() => setPage("connections")}
                          >
                            <span>
                              {
                                (
                                  {
                                    host: "Host resources",
                                    docker: "Docker engine",
                                    gpu: "NVIDIA GPU",
                                    runner: "Runner metrics",
                                    gitlab: "GitLab projects",
                                    services: "System services",
                                    findings: "Survey archive",
                                  } as Record<string, string>
                                )[key]
                              }
                            </span>
                            <Badge
                              value={value.stale ? "stale" : value.status}
                            />
                            <ChevronRight size={15} />
                          </button>
                        ))}
                      </div>
                    )}
                  </PaginatedList>
                </Panel>
                <Panel title="Storage headroom">
                  {host?.volumes?.length ? (
                    <PaginatedList
                      items={host.volumes as any[]}
                      label="Storage headroom"
                      initialSize={5}
                    >
                      {(pageRows) => (
                        <>
                          {pageRows.map((v: any) => (
                            <div className="volume" key={v.mount}>
                              <div>
                                <strong>{v.mount}</strong>
                                <span>
                                  {bytes(v.free)} free of {bytes(v.total)}
                                </span>
                              </div>
                              <Meter value={v.percent} warnAt={85} badAt={95} />
                              <small>
                                {v.device} · {v.fstype} · {pct(v.percent)} used
                              </small>
                            </div>
                          ))}
                        </>
                      )}
                    </PaginatedList>
                  ) : (
                    <Empty
                      title="No filesystem data yet"
                      text="Check the host collector connection."
                    />
                  )}
                </Panel>
              </div>
              {snapshot && (
                <ResourceDiagnostics history={history} snapshot={snapshot} />
              )}
              <div className="two-column">
                <Panel
                  title="Network throughput"
                  note="Whole node · bytes per second"
                >
                  <Chart
                    loading={loading}
                    history={history}
                    percent={false}
                    keys={[
                      ["rx", "Received", "var(--series-1)"],
                      ["tx", "Sent", "var(--series-3)"],
                    ]}
                  />
                  <p className="panel-description">
                    Physical and non-excluded interface totals. Docker bridges,
                    veth, br- and Tailscale interfaces are excluded by the
                    collector to reduce double counting.
                  </p>
                </Panel>
                <Panel
                  title="CI queue over time"
                  note="Whole node · sampled pending jobs"
                >
                  {history.filter((sample) => sample.queued != null).length >=
                  2 ? (
                    <Chart
                      loading={loading}
                      history={history}
                      percent={false}
                      count
                      keys={[["queued", "Pending jobs", "var(--series-4)"]]}
                    />
                  ) : (
                    <Empty
                      title="Queue history is unavailable"
                      text="Connect GitLab and retain two samples to see pending job counts. Missing samples are not counted as zero."
                    />
                  )}
                  <p className="panel-description">
                    Counts cover configured projects sampled by GitLab. Hardware
                    and queue history are not filtered by repository scope.
                  </p>
                </Panel>
              </div>
            </>
          )}
          {snapshot && page === "host" && (
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
              {snapshot && (
                <ResourceDiagnostics history={history} snapshot={snapshot} />
              )}
              <div className="two-column">
                <Panel title="Host facts">
                  <dl className="facts">
                    <dt>Hostname</dt>
                    <dd>{host?.hostname || "n/a"}</dd>
                    <dt>Collection scope</dt>
                    <dd>
                      {host?.scope === "host"
                        ? "Linux node"
                        : host?.scope === "native"
                          ? "Native node"
                          : host?.scope === "container"
                            ? "Container view"
                            : "n/a"}
                    </dd>
                    <dt>Operating system</dt>
                    <dd>{host?.os || "n/a"}</dd>
                    <dt>Uptime</dt>
                    <dd>
                      {host
                        ? duration(snapshot!.server_time - host.boot_time)
                        : "n/a"}
                    </dd>
                    <dt>Load average (1 / 5 / 15m)</dt>
                    <dd>
                      {host?.cpu.load
                        .map((n: number) => n.toFixed(2))
                        .join(" / ") || "n/a"}
                    </dd>
                    <dt>CPU frequency</dt>
                    <dd>
                      {host?.cpu.mhz
                        ? `${Math.round(host.cpu.mhz)} MHz`
                        : "n/a"}
                    </dd>
                    <dt>Processes</dt>
                    <dd>{host?.processes ?? "n/a"}</dd>
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
                      <Meter
                        value={host?.pressure?.[key]?.some?.avg60}
                        warnAt={10}
                        badAt={25}
                      />
                      <strong>{pct(host?.pressure?.[key]?.some?.avg60)}</strong>
                    </div>
                  ))}
                </Panel>
              </div>
              <Panel title="Filesystem capacity">
                <PaginatedList
                  items={host?.volumes || ([] as any[])}
                  label="Filesystems"
                >
                  {(pageRows) => (
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Mount</th>
                            <th>Device</th>
                            <th className="num">Capacity</th>
                            <th className="num">Available</th>
                            <th>Usage</th>
                            <th className="num">Inodes used</th>
                          </tr>
                        </thead>
                        <tbody>
                          {pageRows.map((v: any) => (
                            <tr key={v.mount}>
                              <td>
                                <strong>{v.mount}</strong>
                                <small>{v.fstype}</small>
                              </td>
                              <td>{v.device}</td>
                              <td className="num">{bytes(v.total)}</td>
                              <td className="num">{bytes(v.free)}</td>
                              <td>
                                <div className="usage-cell">
                                  <Meter
                                    value={v.percent}
                                    warnAt={85}
                                    badAt={95}
                                  />
                                  <span>{pct(v.percent)}</span>
                                </div>
                              </td>
                              <td className="num">{pct(v.inode_percent)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </PaginatedList>
              </Panel>
              <Panel title="Device inventory">
                <PaginatedList
                  items={host?.inventory || ([] as any[])}
                  label="Devices"
                >
                  {(pageRows) => (
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Device</th>
                            <th className="num">Capacity</th>
                            <th>Media</th>
                            <th>Filesystem / partitions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {pageRows.map((d: any) => (
                            <tr key={d.name}>
                              <td>{d.name}</td>
                              <td className="num">{bytes(d.size)}</td>
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
                  )}
                </PaginatedList>
                <p className="panel-description">
                  Device ownership and contents must be checked separately
                  before repurposing a drive.
                </p>
              </Panel>
              <Panel title="Physical disks & I/O">
                <PaginatedList
                  items={host?.disks || ([] as any[])}
                  label="Physical disks"
                >
                  {(pageRows) => (
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Device</th>
                            <th className="num">Read / write</th>
                            <th className="num">Operations/s</th>
                            <th className="num">Average latency</th>
                            <th className="num">Busy</th>
                          </tr>
                        </thead>
                        <tbody>
                          {pageRows.map((d: any) => (
                            <tr key={d.name}>
                              <td>{d.name}</td>
                              <td className="num">
                                {bytes(d.read_bytes_s)}/s /{" "}
                                {bytes(d.write_bytes_s)}
                                /s
                              </td>
                              <td className="num">
                                {d.iops?.toFixed(1) ?? "n/a"}
                              </td>
                              <td className="num">
                                {d.await_ms == null
                                  ? "n/a"
                                  : `${d.await_ms.toFixed(1)} ms`}
                              </td>
                              <td className="num">{pct(d.busy_percent)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </PaginatedList>
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
                  {
                    <PaginatedList
                      items={
                        host?.network?.filter(
                          (n: any) =>
                            showVirtualNetwork ||
                            !/^(docker|veth|br-)/.test(n.name),
                        ) || ([] as any[])
                      }
                      label="Network interfaces"
                      initialSize={10}
                      resetKey={showVirtualNetwork ? "all" : "physical"}
                    >
                      {(pageRows) => (
                        <>
                          {pageRows.map((n: any) => (
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
                                <span title="Received">
                                  <ArrowDown size={13} aria-label="Received" />
                                  {bytes(n.rx_bytes_s)}/s
                                </span>
                                <span title="Sent">
                                  <ArrowUp size={13} aria-label="Sent" />
                                  {bytes(n.tx_bytes_s)}/s
                                </span>
                              </span>
                            </div>
                          ))}
                        </>
                      )}
                    </PaginatedList>
                  }
                </Panel>
                <Panel title="GPU & temperatures">
                  <SourceNotice source={sources.gpu} name="GPU" />
                  {sources.gpu?.data?.length > 0 && (
                    <PaginatedList
                      items={sources.gpu?.data || ([] as any[])}
                      label="GPU devices"
                      initialSize={10}
                    >
                      {(pageRows) => (
                        <>
                          {pageRows.map((g: any) => (
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
                                <dd>{g.temperature ?? "n/a"} °C</dd>
                                <dt>Power draw / limit</dt>
                                <dd>
                                  {g.power_w ?? "n/a"} /{" "}
                                  {g.power_limit_w ?? "n/a"} W
                                </dd>
                                <dt>Driver</dt>
                                <dd>{g.driver}</dd>
                              </dl>
                            </div>
                          ))}
                        </>
                      )}
                    </PaginatedList>
                  )}
                  <PaginatedList
                    items={host?.temperatures || ([] as any[])}
                    label="Temperature sensors"
                    initialSize={10}
                  >
                    {(pageRows) => (
                      <div className="temperature-list">
                        {pageRows.map((t: any, i: number) => (
                          <span key={i}>
                            <Thermometer size={13} />
                            {t.label || t.sensor}: {t.current} °C
                          </span>
                        ))}
                      </div>
                    )}
                  </PaginatedList>
                </Panel>
              </div>
            </>
          )}
          {snapshot && page === "host" && (
            <>
              <Panel title="System services">
                <SourceNotice source={sources.services} name="Services" />
                <PaginatedList
                  items={sources.services?.data || ([] as any[])}
                  label="System services"
                >
                  {(pageRows) => (
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Service</th>
                            <th>State</th>
                            <th>Detail</th>
                            <th className="num">Memory</th>
                            <th className="num">Exit code</th>
                          </tr>
                        </thead>
                        <tbody>
                          {pageRows.map((s: any) => (
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
                              <td className="num">{bytes(s.memory_bytes)}</td>
                              <td className="num">{s.exit_code ?? "n/a"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </PaginatedList>
              </Panel>
              <Panel title="Processes with the largest memory footprint">
                <PaginatedList
                  items={host?.top_processes || ([] as any[])}
                  label="Processes"
                >
                  {(pageRows) => (
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Process</th>
                            <th className="num">PID</th>
                            <th className="num">Resident memory</th>
                            <th className="num">CPU</th>
                          </tr>
                        </thead>
                        <tbody>
                          {pageRows.map((p: any) => (
                            <tr key={p.pid}>
                              <td className="truncate" title={p.name}>
                                {p.name}
                              </td>
                              <td className="num">{p.pid}</td>
                              <td className="num">{bytes(p.memory_bytes)}</td>
                              <td className="num">{pct(p.cpu_percent)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </PaginatedList>
                <p className="panel-description">
                  Top 15 by resident memory. Process CPU needs two samples.
                  Arguments and environment variables are not collected.
                </p>
              </Panel>
            </>
          )}
          {snapshot && page === "docker" && (
            <>
              <SourceNotice source={sources.docker} name="Docker" />
              <div className="summary-row">
                <div>
                  <Box />
                  <strong>{docker?.total_containers ?? "n/a"}</strong>
                  <span>Containers</span>
                </div>
                <div>
                  <Activity />
                  <strong>
                    {docker
                      ? containers.filter((c) => c.state === "running").length
                      : "n/a"}
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
                      onChange={(e) => {
                        setQuery(e.target.value);
                        setContainerPage(1);
                      }}
                    />
                  </label>
                  <select
                    aria-label="Container state"
                    value={containerFilter}
                    onChange={(e) => {
                      setContainerFilter(e.target.value);
                      setContainerPage(1);
                    }}
                  >
                    <option value="all">All states</option>
                    <option value="running">Running</option>
                    <option value="exited">Exited</option>
                    <option value="paused">Paused</option>
                    <option value="restarting">Restarting</option>
                    <option value="created">Created</option>
                  </select>
                  <select
                    aria-label="Container ownership"
                    value={containerRole}
                    onChange={(e) => {
                      setContainerRole(e.target.value);
                      setContainerPage(1);
                    }}
                  >
                    <option value="all">All ownership</option>
                    <option value="ci">CI containers</option>
                    <option value="managed">Managed services</option>
                    <option value="observe">Observe only</option>
                  </select>
                  <select
                    aria-label="Sort containers"
                    value={containerSort}
                    onChange={(e) => {
                      setContainerSort(e.target.value);
                      setContainerPage(1);
                    }}
                  >
                    <option value="name">Name</option>
                    <option value="cpu">Highest CPU</option>
                    <option value="memory">Highest memory</option>
                  </select>
                  <button
                    onClick={() => {
                      setQuery("");
                      setContainerFilter("all");
                      setContainerRole("all");
                      setContainerSort("name");
                      setContainerPage(1);
                    }}
                  >
                    Reset filters
                  </button>
                </div>
                {filteredContainers.length ? (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Container</th>
                          <th>State</th>
                          <th className="num">CPU</th>
                          <th className="num">Memory</th>
                          <th>Ownership</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredContainers
                          .slice(
                            (containerCurrentPage - 1) * 20,
                            containerCurrentPage * 20,
                          )
                          .map((c) => (
                            <tr key={c.id}>
                              <td className="truncate">
                                <strong title={c.name}>{c.name}</strong>
                                <small title={c.image}>{c.image}</small>
                              </td>
                              <td>
                                <Badge value={c.state} />
                                <small>{c.status}</small>
                              </td>
                              <td className="num">{pct(c.cpu_percent)}</td>
                              <td className="num">
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
                                      onClick={() =>
                                        previewAction("stop", c.id)
                                      }
                                    >
                                      Stop
                                    </button>
                                  </div>
                                ) : (
                                  "n/a"
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
                <Pager
                  total={filteredContainers.length}
                  page={containerCurrentPage}
                  size={20}
                  onPage={setContainerPage}
                />
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
          {snapshot && page === "operations" && (
            <OperatorConsole
              token={token}
              images={allDocker?.images || []}
              onChanged={() => setRefresh((value) => value + 1)}
            />
          )}
          {snapshot && page === "survey" && (
            <>
              <LiveCheckpoints
                token={token}
                scope={scope}
                view={workload.data}
                onChanged={() => setRefresh((value) => value + 1)}
              />
              <div className="notice info">
                <ClipboardList size={18} />
                <div>
                  <strong>
                    Imported benchmark evidence
                    {archiveRepository ? ` · ${archiveRepository}` : ""}
                  </strong>
                  <p>
                    This dated report is separate from live checkpoints and
                    follows repository scope. Its recorded pipeline comparisons
                    keep their original scope.
                  </p>
                </div>
              </div>
              {archiveMatches ? (
                <SurveyPage source={sources.findings} />
              ) : (
                <div className="empty">
                  <p>
                    No imported benchmark report is available for this
                    repository. Use live checkpoints above, or choose All
                    repositories to read the original report.
                  </p>
                </div>
              )}
            </>
          )}
          {snapshot && page === "optimization" && (
            <RecordedOptimizations archive={sources.findings?.data} />
          )}
          {snapshot && page === "gitlab" && (
            <>
              <PipelineDiagnostics
                pipelines={pipelines}
                jobs={jobs}
                fresh={ciKnown && !sources.gitlab?.stale}
              />
              <SourceNotice source={sources.docker} name="Docker" />
              <RunnerTelemetry
                source={sources.runner}
                service={
                  sources.services?.status === "healthy" &&
                  !sources.services?.stale
                    ? sources.services?.data?.find(
                        (row: any) => row.name === "gitlab-runner.service",
                      )
                    : undefined
                }
              />
              <RunnerInventory
                key={JSON.stringify(scope)}
                docker={docker}
                archive={archiveMatches ? sources.findings?.data : undefined}
                host={host}
              />
            </>
          )}
          {snapshot &&
            page === "gitlab" &&
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
                        : "n/a"}
                    </strong>
                    <span>Running pipelines</span>
                  </div>
                  <div>
                    <Activity />
                    <strong>
                      {ciKnown
                        ? jobs.filter((j) => j.status === "pending").length
                        : "n/a"}
                    </strong>
                    <span>Pending jobs in sample</span>
                  </div>
                  <div>
                    <Cpu />
                    <strong>
                      {runnerMetrics.gitlab_runner_concurrent ??
                        sources.runner?.data?.facts?.concurrent ??
                        "n/a"}
                    </strong>
                    <span>Configured runner slots</span>
                  </div>
                  <div>
                    <Server />
                    <strong>{gitlab?.projects?.length ?? "n/a"}</strong>
                    <span>Connected projects</span>
                  </div>
                </div>
                <Panel
                  title="Recent & active pipelines"
                  note="GitLab is read-only"
                >
                  {pipelines.length ? (
                    <PaginatedList
                      items={pipelines || ([] as any[])}
                      label="GitLab pipelines"
                      resetKey={JSON.stringify(scope)}
                    >
                      {(pageRows) => (
                        <div className="table-wrap">
                          <table>
                            <thead>
                              <tr>
                                <th>Pipeline / project</th>
                                <th>Branch</th>
                                <th>Status</th>
                                <th className="num">Duration</th>
                                <th className="num">Queue duration</th>
                                <th>Created</th>
                              </tr>
                            </thead>
                            <tbody>
                              {pageRows.map((p) => (
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
                                  <td className="num">
                                    {duration(p.duration)}
                                  </td>
                                  <td className="num">
                                    {duration(p.queued_duration)}
                                  </td>
                                  <td>
                                    {p.created_at
                                      ? new Date(p.created_at).toLocaleString()
                                      : "n/a"}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </PaginatedList>
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
                        value={jobQuery}
                        onChange={(e) => {
                          setJobQuery(e.target.value);
                        }}
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
                    <PaginatedList
                      items={filteredJobs as any[]}
                      label="GitLab jobs"
                      resetKey={`${JSON.stringify(scope)}:${jobQuery}:${jobFilter}`}
                    >
                      {(pageRows) => (
                        <div className="table-wrap">
                          <table>
                            <thead>
                              <tr>
                                <th>Job</th>
                                <th>Pipeline</th>
                                <th>Status</th>
                                <th className="num">Execution</th>
                                <th className="num">Queue</th>
                                <th>Runner</th>
                              </tr>
                            </thead>
                            <tbody>
                              {pageRows.map((j) => (
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
                                  <td className="num">
                                    {duration(j.duration)}
                                  </td>
                                  <td className="num">
                                    {duration(j.queued_duration)}
                                  </td>
                                  <td>{j.runner || "Unassigned"}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </PaginatedList>
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
              </>
            )}
          {snapshot && page === "optimization" && (
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
              <PaginatedList
                items={snapshot?.recommendations || ([] as any[])}
                label="Recommendations"
                initialSize={10}
              >
                {(pageRows) => (
                  <div className="recommendations">
                    {pageRows.map((r) => (
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
                )}
              </PaginatedList>
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
          {snapshot && page === "activity" && (
            <>
              <Panel title="Active conditions" note={`${alerts.length} active`}>
                {alerts.length ? (
                  <PaginatedList
                    items={alerts as any[]}
                    label="Active conditions"
                    initialSize={10}
                  >
                    {(pageRows) => (
                      <div className="event-list">
                        {pageRows.map((a) => (
                          <div key={a.key} className={tone(a.severity)}>
                            <TriangleAlert size={18} />
                            <div>
                              <strong>{a.title}</strong>
                              <p>{a.detail}</p>
                            </div>
                            <Badge value={a.severity} />
                          </div>
                        ))}
                      </div>
                    )}
                  </PaginatedList>
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
                <EventHistory events={events} />
              </Panel>
            </>
          )}
          {snapshot && page === "connections" && (
            <>
              <GitLabSetup
                token={token}
                onChanged={() => setRefresh((value) => value + 1)}
              />
              <PaginatedList
                items={Object.entries(sources) as any[]}
                label="Connections"
                initialSize={10}
              >
                {(pageRows) => (
                  <div className="connection-grid">
                    {pageRows.map(([key, s]) => (
                      <Panel
                        key={key}
                        title={
                          key === "gpu"
                            ? "NVIDIA GPU"
                            : key === "gitlab"
                              ? "GitLab projects"
                              : key === "runner"
                                ? "Runner metrics"
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
                              ? new Date(
                                  s.updated_at * 1000,
                                ).toLocaleTimeString()
                              : "Waiting"}
                          </dd>
                          <dt>Sample age</dt>
                          <dd>{duration(s.age_seconds)}</dd>
                        </dl>
                      </Panel>
                    ))}
                  </div>
                )}
              </PaginatedList>
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
                      {snapshot?.retention_days ?? "n/a"} days. Audit action
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
