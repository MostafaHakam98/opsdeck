import React, { lazy, Suspense, useCallback, useEffect, useState } from "react";
import {
  Activity,
  ArrowLeft,
  Download,
  Keyboard,
  LayoutGrid,
  LogOut,
  Network,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  Table2,
} from "lucide-react";
import { api, download } from "../../lib/api";
import { ThemeToggle } from "../../components/ThemeToggle";
import { HostSwitcher } from "../../components/HostSwitcher";
import {
  CommandPalette,
  openCommandPalette,
  type Command,
} from "../../components/CommandPalette";
import { LiveIndicator } from "../../components/LiveIndicator";
import { ShortcutHelp, openShortcutHelp } from "../../components/ShortcutHelp";
import { useHotkey } from "../../lib/useHotkey";
import { AgentCredential } from "./AgentCredential";
import { FleetOverview } from "./FleetOverview";
import { FleetAudit } from "./FleetAudit";
import { DangerZone, HostSettings } from "./HostSettings";
import type { HostLayout } from "./HostsView";
import {
  filterAlerts,
  filterNodes,
  fileStamp,
  fleetAlerts,
  fleetSummary,
  hostsCsv,
  readStored,
  sortNodes,
  writeStored,
  type SortDirection,
  type SortKey,
} from "./fleetModel";
import type { Credential, PulseMetric } from "./types";
import "./fleet.css";
import { hostPages, hostPageGroups, hostPageId } from "../../app/navigation";
import { AppSidebar } from "../../components/AppSidebar";
import { HostApiProvider } from "../../lib/HostApi";
import { useFleetData } from "./useFleetData";

const HostWorkspace = lazy(() =>
  import("../../app/HostWorkspace").then((module) => ({
    default: module.HostWorkspace,
  })),
);
const NodeDetail = lazy(() =>
  import("./NodeDetail").then((module) => ({ default: module.NodeDetail })),
);

const local = () => window.localStorage;
const session = () => window.sessionStorage;
const LAYOUT_KEY = "opsdeck.fleet.layout";
const GROUP_KEY = "opsdeck.fleet.grouped";
const PAUSE_KEY = "opsdeck.fleet.paused";
const NUMERIC_SORTS: SortKey[] = ["cpu", "memory", "gpu", "ci"];
const SHORTCUTS = [
  { keys: ["Ctrl", "K"], label: "Open the command palette" },
  { keys: ["/"], label: "Open the command palette" },
  { keys: ["R"], label: "Refresh fleet data now" },
  { keys: ["?"], label: "Show keyboard shortcuts" },
  { keys: ["Esc"], label: "Close the palette or a dialog" },
];

export function FleetApp({
  signIn,
}: {
  signIn: (callback: (token: string) => void) => React.ReactNode;
}) {
  const [token, setToken] = useState(
    () => sessionStorage.getItem("opsdeck.token") || "",
  );
  const [cluster, setCluster] = useState("");
  const [query, setQuery] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [selected, setSelected] = useState(
    () => new URLSearchParams(window.location.search).get("node") || "",
  );
  const [section, setSection] = useState(() =>
    hostPageId(
      new URLSearchParams(window.location.search).get("section") || undefined,
    ),
  );
  const [workspaceRequested, setWorkspaceRequested] = useState(false);
  const [view, setView] = useState("fleet");
  const [hours, setHours] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);
  const [credential, setCredential] = useState<Credential | null>(null);
  const [name, setName] = useState("");
  const [newCluster, setNewCluster] = useState("");
  const [confirm, setConfirm] = useState("");
  const [paused, setPaused] = useState(
    () => readStored(session, PAUSE_KEY, "") === "1",
  );
  const [layout, setLayout] = useState<HostLayout>(() =>
    readStored(local, LAYOUT_KEY, "grid") === "table" ? "table" : "grid",
  );
  const [grouped, setGrouped] = useState(
    () => readStored(local, GROUP_KEY, "") === "1",
  );
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [pulseMetric, setPulseMetric] = useState<PulseMetric>("cpu");
  const [pulseMinutes, setPulseMinutes] = useState(60);
  const [fleetHours, setFleetHours] = useState(1);
  const [auditQuery, setAuditQuery] = useState("");
  const [auditLimit, setAuditLimit] = useState(100);
  const data = useFleetData({
    token,
    selected,
    hours,
    refresh,
    view,
    paused,
    pulseMinutes,
    fleetHours,
    cluster,
    auditQuery,
    auditLimit,
  });
  const { fleet, detail, history, events, error, clearHost, clearHistory } =
    data;
  const nodes = fleet?.nodes || [];
  const clusters = [...new Set(nodes.map((n) => n.cluster))].sort((a, b) =>
    a.localeCompare(b),
  );
  const scoped = nodes.filter((n) => !cluster || n.cluster === cluster);
  const filtered = sortNodes(
    filterNodes(nodes, { query, state: stateFilter, cluster }),
    sortKey,
    sortDirection,
  );
  const alerts = fleetAlerts(fleet);
  const summary = fleetSummary(fleet, cluster);
  const workspaceOpen =
    view === "fleet" &&
    !!selected &&
    (!!detail?.workspace_connected || workspaceRequested);
  const refreshNow = useCallback(() => setRefresh((v) => v + 1), []);
  useHotkey("r", () => {
    // The one-time credential dialog owns the keyboard until it is saved.
    if (token && !workspaceOpen && !credential) refreshNow();
  });
  useEffect(() => {
    function restoreHost() {
      setSelected(
        new URLSearchParams(window.location.search).get("node") || "",
      );
      setSection(
        hostPageId(
          new URLSearchParams(window.location.search).get("section") ||
            undefined,
        ),
      );
      setWorkspaceRequested(
        new URLSearchParams(window.location.search).has("section"),
      );
      setView("fleet");
      setCluster("");
      clearHost();
      setConfirm("");
      setActionError("");
    }
    window.addEventListener("popstate", restoreHost);
    return () => window.removeEventListener("popstate", restoreHost);
  }, []);
  function rememberHost(id: string) {
    const url = new URL(window.location.href);
    if (
      (url.searchParams.get("node") || "") === id &&
      (id || !url.searchParams.has("section"))
    )
      return;
    if (id) url.searchParams.set("node", id);
    else {
      url.searchParams.delete("node");
      url.searchParams.delete("section");
    }
    window.history.pushState(null, "", url);
  }
  function navigate(next: string, nextCluster = cluster) {
    rememberHost("");
    setWorkspaceRequested(false);
    setView(next);
    setSelected("");
    clearHost();
    setCluster(nextCluster);
    setActionError("");
    setConfirm("");
  }
  function selectNode(id: string) {
    rememberHost(id);
    setSection(
      hostPageId(
        new URLSearchParams(window.location.search).get("section") || undefined,
      ),
    );
    setView("fleet");
    setSelected(id);
    clearHost();
    setConfirm("");
    setActionError("");
    setRefresh((value) => value + 1);
  }
  function switchHost(id: string) {
    setQuery("");
    setStateFilter("");
    setCluster("");
    if (id) selectNode(id);
    else navigate("fleet", "");
  }
  function openSection(next: string) {
    const id = selected || (nodes.length === 1 ? nodes[0].id : "");
    setSection(next);
    setWorkspaceRequested(true);
    const url = new URL(window.location.href);
    url.searchParams.set("section", next);
    window.history.replaceState(null, "", url);
    if (id) selectNode(id);
  }
  function signOut() {
    void api("auth/logout", token, {}).catch(() => {});
    sessionStorage.removeItem("opsdeck.token");
    setToken("");
    setCredential(null);
  }
  function togglePause() {
    setPaused((value) => {
      writeStored(session, PAUSE_KEY, value ? "" : "1");
      return !value;
    });
  }
  function changeLayout(next: HostLayout) {
    setLayout(next);
    writeStored(local, LAYOUT_KEY, next);
  }
  function changeGrouped(next: boolean) {
    setGrouped(next);
    writeStored(local, GROUP_KEY, next ? "1" : "");
  }
  function sortBy(key: SortKey, direction?: SortDirection) {
    setSortDirection(
      direction ||
        (key === sortKey
          ? sortDirection === "asc"
            ? "desc"
            : "asc"
          : NUMERIC_SORTS.includes(key)
            ? "desc"
            : "asc"),
    );
    setSortKey(key);
  }
  function exportHosts() {
    download(
      `opsdeck-hosts-${fileStamp()}.csv`,
      hostsCsv(filtered),
      "text/csv",
    );
  }
  async function mutate(path: string, values: unknown, reveal: boolean) {
    setBusy(true);
    setActionError("");
    try {
      const result = await api<Credential>(path, token, values);
      if (reveal) {
        setCredential(result);
      }
      setConfirm("");
      setRefresh((v) => v + 1);
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!token)
    return signIn((value) => {
      sessionStorage.setItem("opsdeck.token", value);
      setToken(value);
    });
  if (workspaceOpen) {
    return (
      <HostApiProvider prefix={`fleet/nodes/${selected}/workspace/`}>
        <Suspense
          fallback={
            <main className="login">
              <p>Opening host workspace…</p>
            </main>
          }
        >
          <HostWorkspace
            key={selected}
            fleet={{
              hosts: nodes,
              selected,
              initialPage: section,
              onHost: switchHost,
              onFleet: () => navigate("fleet", ""),
              onEnroll: () => navigate("enroll"),
              onAgent: () => setView("agent"),
              onSignOut: signOut,
            }}
          />
        </Suspense>
      </HostApiProvider>
    );
  }
  const selectedNode = nodes.find((n) => n.id === selected);
  const commands: Command[] = [
    {
      id: "fleet",
      label: "Fleet overview",
      group: "Fleet",
      icon: Network,
      run: () => navigate("fleet", ""),
    },
    {
      id: "enroll",
      label: "Enroll host",
      group: "Fleet",
      icon: Plus,
      run: () => navigate("enroll"),
    },
    {
      id: "audit",
      label: "Fleet audit",
      group: "Fleet",
      icon: Activity,
      run: () => navigate("audit"),
    },
    ...nodes.map((n) => ({
      id: `host:${n.id}`,
      label: `Open ${n.name}`,
      hint: n.cluster,
      group: "Hosts",
      icon: Server,
      keywords: `${n.hostname || ""} ${n.cluster} ${n.status} ${n.notes || ""}`,
      run: () => switchHost(n.id),
    })),
    ...clusters.map((c) => ({
      id: `cluster:${c}`,
      label: `Show cluster ${c}`,
      hint: `${nodes.filter((n) => n.cluster === c).length} hosts`,
      group: "Clusters",
      icon: Network,
      run: () => navigate("fleet", c),
    })),
    ...(selectedNode
      ? hostPages.map((p) => ({
          id: `page:${p.id}`,
          label: `${p.title} on ${selectedNode.name}`,
          hint: p.group,
          group: "Host workspace",
          icon: p.icon,
          keywords: p.description,
          run: () => openSection(p.id),
        }))
      : []),
    {
      id: "layout",
      label:
        layout === "grid" ? "Show hosts as a table" : "Show hosts as a grid",
      group: "View",
      icon: layout === "grid" ? Table2 : LayoutGrid,
      run: () => changeLayout(layout === "grid" ? "table" : "grid"),
    },
    {
      id: "pause",
      label: paused ? "Resume live updates" : "Pause live updates",
      group: "View",
      icon: paused ? Play : Pause,
      run: togglePause,
    },
    {
      id: "refresh",
      label: "Refresh now",
      hint: "R",
      group: "View",
      icon: RefreshCw,
      run: refreshNow,
    },
    {
      id: "export",
      label: "Export hosts as CSV",
      hint: `${filtered.length} hosts`,
      group: "View",
      icon: Download,
      run: exportHosts,
    },
    {
      id: "shortcuts",
      label: "Keyboard shortcuts",
      hint: "?",
      group: "View",
      icon: Keyboard,
      run: openShortcutHelp,
    },
    {
      id: "signout",
      label: "Sign out",
      group: "Account",
      icon: LogOut,
      run: signOut,
    },
  ];
  return (
    <div className="workspace">
      <AppSidebar
        caption="Runner fleet"
        onHome={() => navigate("fleet", "")}
        onSignOut={signOut}
        footer={
          <div className="sidebar-status">
            <p>
              <ShieldCheck size={16} />
              Monitoring enabled
            </p>
            <small>
              History retained for {fleet?.retention_days ?? 30} days
              {fleet?.version ? `. Version ${fleet.version}` : ""}
            </small>
          </div>
        }
        groups={[
          {
            label: "Fleet",
            items: [
              {
                id: "fleet",
                label: "All clusters",
                icon: Network,
                active: view === "fleet" && !selected && !cluster,
                count: nodes.length,
                alert: alerts.some((a) => a.severity === "critical"),
                onClick: () => navigate("fleet", ""),
              },
              {
                id: "enroll",
                label: "Enroll host",
                icon: Plus,
                active: view === "enroll",
                onClick: () => navigate("enroll"),
              },
              {
                id: "audit",
                label: "Fleet audit",
                icon: Activity,
                active: view === "audit",
                onClick: () => navigate("audit"),
              },
            ],
          },
          {
            label: "Clusters",
            mobileHidden: true,
            items: clusters.map((c) => ({
              id: c,
              label: c,
              icon: Server,
              active: cluster === c && view === "fleet",
              count: nodes.filter((n) => n.cluster === c).length,
              onClick: () => navigate("fleet", c),
            })),
          },
          ...hostPageGroups.map((group) => ({
            label: group,
            items: hostPages
              .filter((p) => p.group === group)
              .map((p) => ({
                id: p.id,
                label: p.title,
                icon: p.icon,
                onClick: () => openSection(p.id),
              })),
          })),
        ]}
      />
      <div className="main fleet-body">
        <header className="fleet-topbar">
          <HostSwitcher
            hosts={nodes}
            value={selected}
            onChange={switchHost}
            allLabel={`All hosts (${nodes.length})`}
            loading={!fleet}
          />
          <button
            type="button"
            className="fleet-jump"
            aria-label="Search or jump to"
            aria-keyshortcuts="Control+K"
            onClick={openCommandPalette}
          >
            <Search size={15} aria-hidden="true" />
            <span>Search or jump to</span>
            <kbd>Ctrl K</kbd>
          </button>
          <div className="fleet-topbar-tools">
            <LiveIndicator
              updatedAt={data.updatedAt}
              error={error || undefined}
              paused={paused}
              onTogglePause={togglePause}
            />
            <button
              type="button"
              className="fleet-icon-button"
              aria-label="Refresh fleet"
              title="Refresh now (R)"
              onClick={refreshNow}
            >
              <RefreshCw size={16} />
            </button>
            <ThemeToggle />
            <button
              className="fleet-mobile-signout fleet-icon-button"
              aria-label="Sign out"
              onClick={signOut}
            >
              <LogOut size={16} />
            </button>
          </div>
        </header>
        <main className="fleet-main">
          {error && (
            <div className="fleet-warning" role="alert">
              {error} Retained values may be out of date; OpsDeck keeps
              retrying.
            </div>
          )}
          {actionError && (
            <div className="fleet-warning" role="alert">
              {actionError}
            </div>
          )}
          {workspaceRequested && !selected && (
            <p className="fleet-warning">
              Select a host to open{" "}
              {hostPages.find((p) => p.id === section)?.title ||
                "its workspace"}
              .
            </p>
          )}
          {view === "fleet" && !selected && (
            <FleetOverview
              loaded={!!fleet}
              title={cluster || "Runner fleet"}
              scoped={scoped}
              summary={summary}
              alerts={filterAlerts(alerts, cluster, query)}
              pulse={data.pulse}
              pulseError={data.pulseError}
              pulseMetric={pulseMetric}
              pulseMinutes={pulseMinutes}
              onPulseMetric={setPulseMetric}
              onPulseMinutes={setPulseMinutes}
              history={data.fleetHistory}
              historyError={data.fleetHistoryError}
              historyHours={fleetHours}
              onHistoryHours={(value) => {
                setFleetHours(value);
                data.clearFleetHistory();
              }}
              onOpen={selectNode}
              onEnroll={() => navigate("enroll")}
              hosts={{
                nodes: filtered,
                scoped,
                allCount: nodes.length,
                clusters,
                query,
                onQuery: setQuery,
                state: stateFilter,
                onState: setStateFilter,
                cluster,
                onCluster: (value) => navigate("fleet", value),
                layout,
                onLayout: changeLayout,
                grouped,
                onGrouped: changeGrouped,
                sortKey,
                sortDirection,
                onSort: sortBy,
                pulse: data.pulse,
                pulseMetric,
                serverTime: fleet?.server_time ?? null,
                onOpen: selectNode,
                onExport: exportHosts,
              }}
            />
          )}
          {(view === "fleet" || view === "agent") && selected && (
            <>
              <button
                type="button"
                className="fleet-back"
                onClick={() => navigate("fleet")}
              >
                <ArrowLeft size={15} aria-hidden="true" />
                Back to hosts
              </button>
              {detail ? (
                <Suspense
                  fallback={
                    <p className="fleet-empty">Loading host observations…</p>
                  }
                >
                  <NodeDetail
                    key={selected}
                    detail={detail}
                    history={history}
                    hours={hours}
                    alerts={alerts.filter((a) => a.node_id === selected)}
                    onHours={(v) => {
                      setHours(v);
                      clearHistory();
                    }}
                  />
                </Suspense>
              ) : (
                <p className="fleet-empty">Loading host observations...</p>
              )}
              {detail && (
                <div className="fleet-admin">
                  <HostSettings
                    key={detail.node.id}
                    node={detail.node}
                    token={token}
                    clusters={clusters}
                    onSaved={refreshNow}
                  />
                  <DangerZone
                    node={detail.node}
                    confirm={confirm}
                    onConfirm={setConfirm}
                    busy={busy}
                    onRotate={() =>
                      void mutate(`fleet/nodes/${selected}/rotate`, {}, true)
                    }
                    onRevoke={() =>
                      void mutate(`fleet/nodes/${selected}/revoke`, {}, false)
                    }
                  />
                </div>
              )}
            </>
          )}
          {view === "enroll" && (
            <>
              <div className="fleet-title">
                <div>
                  <h1>Enroll a runner host</h1>
                  <p>
                    One agent per host. Several runners can share that host.
                  </p>
                </div>
              </div>
              <form
                className="fleet-enroll"
                onSubmit={(e) => {
                  e.preventDefault();
                  void mutate(
                    "fleet/nodes",
                    { name, cluster: newCluster },
                    true,
                  );
                }}
              >
                <label>
                  Host name
                  <input
                    required
                    maxLength={120}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="build-runner-01"
                  />
                </label>
                <label>
                  Cluster or network
                  <input
                    required
                    maxLength={120}
                    list="fleet-enroll-clusters"
                    value={newCluster}
                    onChange={(e) => setNewCluster(e.target.value)}
                    placeholder="Cairo build cluster"
                  />
                  <datalist id="fleet-enroll-clusters">
                    {clusters.map((c) => (
                      <option key={c} value={c} />
                    ))}
                  </datalist>
                </label>
                <p>
                  The agent needs outbound HTTPS access to this server. Its
                  credential is limited to sending this host's telemetry. Next,
                  you save the credential in <code>.env.agent</code> on the host
                  and run <code>make agent-install</code>.
                </p>
                <button className="primary" disabled={busy || !!credential}>
                  {busy ? "Enrolling..." : "Create agent credential"}
                </button>
              </form>
            </>
          )}
          {view === "audit" && (
            <FleetAudit
              events={events}
              query={auditQuery}
              onQuery={setAuditQuery}
              limit={auditLimit}
              onLimit={setAuditLimit}
              serverTime={fleet?.server_time ?? null}
            />
          )}
        </main>
      </div>
      {/* Keep overlays and their "Sign out" away from the one-time credential. */}
      {!credential && <CommandPalette commands={commands} />}
      {!credential && <ShortcutHelp shortcuts={SHORTCUTS} />}
      {credential && (
        <AgentCredential
          key={credential.token}
          credential={credential}
          onSaved={() => {
            setCredential(null);
            setCluster("");
            selectNode(credential.id);
          }}
        />
      )}
    </div>
  );
}
