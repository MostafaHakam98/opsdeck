import React, { lazy, Suspense, useEffect, useState } from "react";
import {
  Activity,
  ArrowLeft,
  ChevronRight,
  LogOut,
  Network,
  Plus,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
} from "lucide-react";
import { api, pct } from "../../lib/api";
import { ThemeToggle } from "../../components/ThemeToggle";
import { HostSwitcher } from "../../components/HostSwitcher";
import { age } from "./format";
import { Status, Table, Section } from "./FleetComponents";
import { AgentCredential } from "./AgentCredential";
import type { Credential } from "./types";
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
  const [status, setStatus] = useState("");
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
  const { fleet, detail, history, events, error, clearHost, clearHistory } =
    useFleetData(token, selected, hours, refresh, view);
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
    setStatus("");
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
    sessionStorage.removeItem("opsdeck.token");
    setToken("");
    setCredential(null);
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
  const nodes = fleet?.nodes || [];
  const clusters = [...new Set(nodes.map((n) => n.cluster))];
  const scoped = nodes.filter((n) => !cluster || n.cluster === cluster);
  const filtered = scoped.filter(
    (n) =>
      (!status || n.status === status) &&
      `${n.name} ${n.hostname || ""} ${n.cluster}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const online = scoped.filter((n) => n.status === "online").length;
  if (
    view === "fleet" &&
    selected &&
    (detail?.workspace_connected || workspaceRequested)
  ) {
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
          <div>
            <button
              aria-label="Refresh fleet"
              onClick={() => setRefresh((v) => v + 1)}
            >
              <RefreshCw size={16} />
            </button>
            <ThemeToggle />
            <button
              className="fleet-mobile-signout"
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
              {error} Retained values may be out of date.
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
            <>
              <div className="fleet-title">
                <div>
                  <h1>{cluster || "Your runner fleet"}</h1>
                  <p>Capacity and health across your runner networks.</p>
                </div>
                <button className="primary" onClick={() => navigate("enroll")}>
                  <Plus size={16} />
                  Enroll host
                </button>
              </div>
              <div className="fleet-summary">
                <strong>
                  {online}
                  <span> online</span>
                </strong>
                <span>
                  {scoped.length - online} waiting, stale, offline, or revoked
                </span>
                <span>
                  {cluster
                    ? "1 cluster"
                    : `${clusters.length} ${clusters.length === 1 ? "cluster" : "clusters"}`}
                </span>
              </div>
              <div className="fleet-filter">
                <label className="fleet-cluster-filter">
                  Cluster
                  <select
                    aria-label="Cluster filter"
                    value={cluster}
                    onChange={(event) => navigate("fleet", event.target.value)}
                  >
                    <option value="">All clusters</option>
                    {clusters.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="fleet-search">
                  <Search size={17} />
                  <input
                    aria-label="Search hosts"
                    placeholder="Search hosts or clusters"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </label>
                <label>
                  Status{" "}
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                  >
                    <option value="">All statuses</option>
                    {["online", "waiting", "stale", "offline", "revoked"].map(
                      (s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ),
                    )}
                  </select>
                </label>
              </div>
              {!fleet ? (
                <p className="fleet-empty">Connecting to the fleet server...</p>
              ) : !nodes.length ? (
                <div className="fleet-onboarding">
                  <Network size={44} />
                  <h2>Connect your first runner host</h2>
                  <p>
                    Enroll a host, then run its agent on the runner network. Its
                    health and resource usage will appear here.
                  </p>
                  <button
                    className="primary"
                    onClick={() => navigate("enroll")}
                  >
                    Enroll host
                    <ChevronRight size={16} />
                  </button>
                </div>
              ) : (
                <Section
                  title={`${filtered.length} ${filtered.length === 1 ? "host" : "hosts"}`}
                >
                  <Table
                    headings={[
                      "Host",
                      "Cluster",
                      "Connection",
                      "CPU",
                      "Memory",
                      "CI workers",
                      "Last observation",
                    ]}
                  >
                    {filtered.map((n) => (
                      <tr key={n.id}>
                        <td>
                          <button
                            className="fleet-host-link"
                            onClick={() => selectNode(n.id)}
                          >
                            {n.name}
                            <ChevronRight size={14} />
                          </button>
                          <small>{n.hostname || "Awaiting agent"}</small>
                        </td>
                        <td>{n.cluster}</td>
                        <td>
                          <Status value={n.status} />
                        </td>
                        <td>{pct(n.metrics.cpu)}</td>
                        <td>{pct(n.metrics.memory)}</td>
                        <td>{n.metrics.ci_running ?? "Unavailable"}</td>
                        <td>{age(n.age_seconds)}</td>
                      </tr>
                    ))}
                  </Table>
                  {!filtered.length && (
                    <p className="fleet-empty">No hosts match these filters.</p>
                  )}
                </Section>
              )}
            </>
          )}
          {(view === "fleet" || view === "agent") && selected && (
            <>
              <button className="fleet-back" onClick={() => navigate("fleet")}>
                <ArrowLeft size={16} />
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
                <Section title="Agent access">
                  <p className="fleet-context">
                    Rotate replaces this host's credential. Revoke stops it from
                    sending telemetry. Retained observations remain available.
                  </p>
                  <label>
                    Type the host name to confirm
                    <input
                      aria-label="Confirm host name"
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      placeholder={detail.node.name}
                    />
                  </label>
                  <div className="fleet-actions">
                    <button
                      disabled={busy || confirm !== detail.node.name}
                      onClick={() =>
                        void mutate(`fleet/nodes/${selected}/rotate`, {}, true)
                      }
                    >
                      Rotate credential
                    </button>
                    <button
                      disabled={
                        busy ||
                        confirm !== detail.node.name ||
                        detail.node.status === "revoked"
                      }
                      onClick={() =>
                        void mutate(`fleet/nodes/${selected}/revoke`, {}, false)
                      }
                    >
                      Revoke agent
                    </button>
                  </div>
                </Section>
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
                    value={newCluster}
                    onChange={(e) => setNewCluster(e.target.value)}
                    placeholder="Cairo build cluster"
                  />
                </label>
                <p>
                  The agent needs outbound HTTPS access to this server. Its
                  credential is limited to sending this host's telemetry.
                </p>
                <button className="primary" disabled={busy || !!credential}>
                  {busy ? "Enrolling..." : "Create agent credential"}
                </button>
              </form>
            </>
          )}
          {view === "audit" && (
            <>
              <div className="fleet-title">
                <div>
                  <h1>Activity & audit</h1>
                  <p>Agent enrollment and access changes.</p>
                </div>
              </div>
              <Section title="Recent events">
                <Table headings={["Time", "Event", "Details"]}>
                  {events.map((e) => (
                    <tr key={e.id}>
                      <td>{new Date(e.ts * 1000).toLocaleString()}</td>
                      <td>{e.title}</td>
                      <td>{e.detail}</td>
                    </tr>
                  ))}
                </Table>
                {!events.length && (
                  <p className="fleet-empty">No access changes recorded yet.</p>
                )}
              </Section>
            </>
          )}
        </main>
      </div>
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
