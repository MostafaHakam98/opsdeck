import React, { useEffect, useState } from "react";
import {
  Activity,
  ArrowLeft,
  ChevronRight,
  Gauge,
  LogOut,
  Network,
  Plus,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
} from "lucide-react";
import { api, pct, type Event } from "../../lib/api";
import { ThemeToggle } from "../../components/ThemeToggle";
import { HostSwitcher } from "../../components/HostSwitcher";
import { age } from "./format";
import { Status, Table, Section } from "./FleetComponents";
import { AgentCredential } from "./AgentCredential";
import { NodeDetail } from "./NodeDetail";
import type { Fleet, Detail, Credential, Point } from "./types";
import "./fleet.css";
import { HostWorkspace, hostPages } from "../../app/HostWorkspace";
import { HostApiProvider } from "../../lib/HostApi";

export function FleetApp({
  signIn,
}: {
  signIn: (callback: (token: string) => void) => React.ReactNode;
}) {
  const [token, setToken] = useState(
    () => sessionStorage.getItem("opsdeck.token") || "",
  );
  const [fleet, setFleet] = useState<Fleet | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [history, setHistory] = useState<Point[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [cluster, setCluster] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [selected, setSelected] = useState(
    () => new URLSearchParams(window.location.search).get("node") || "",
  );
  const [section, setSection] = useState(
    () =>
      new URLSearchParams(window.location.search).get("section") || "overview",
  );
  const [workspaceRequested, setWorkspaceRequested] = useState(false);
  const [view, setView] = useState("fleet");
  const [hours, setHours] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);
  const [credential, setCredential] = useState<Credential | null>(null);
  const [name, setName] = useState("");
  const [newCluster, setNewCluster] = useState("");
  const [confirm, setConfirm] = useState("");
  useEffect(() => {
    function restoreHost() {
      setSelected(
        new URLSearchParams(window.location.search).get("node") || "",
      );
      setSection(
        new URLSearchParams(window.location.search).get("section") ||
          "overview",
      );
      setWorkspaceRequested(
        new URLSearchParams(window.location.search).has("section"),
      );
      setView("fleet");
      setCluster("");
      setDetail(null);
      setHistory([]);
      setConfirm("");
      setActionError("");
    }
    window.addEventListener("popstate", restoreHost);
    return () => window.removeEventListener("popstate", restoreHost);
  }, []);
  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const data = await api<Fleet>(
          "fleet",
          token,
          undefined,
          controller.signal,
        );
        if (active) {
          setFleet(data);
          setError("");
        }
        if (selected) {
          const [node, points] = await Promise.all([
            api<Detail>(
              `fleet/nodes/${selected}`,
              token,
              undefined,
              controller.signal,
            ),
            api<Point[]>(
              `fleet/nodes/${selected}/history?hours=${hours}`,
              token,
              undefined,
              controller.signal,
            ),
          ]);
          if (active) {
            setDetail(node);
            setHistory(points);
          }
        }
        if (view === "audit") {
          const rows = await api<Event[]>(
            "events",
            token,
            undefined,
            controller.signal,
          );
          if (active) setEvents(rows);
        }
      } catch (err) {
        if (active) setError((err as Error).message);
      } finally {
        if (active) timer = setTimeout(load, 10000);
      }
    }
    void load();
    return () => {
      active = false;
      controller.abort();
      clearTimeout(timer);
    };
  }, [token, selected, hours, refresh, view]);
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
    setDetail(null);
    setHistory([]);
    setCluster(nextCluster);
    setActionError("");
    setConfirm("");
  }
  function selectNode(id: string) {
    rememberHost(id);
    setSection(
      new URLSearchParams(window.location.search).get("section") || "overview",
    );
    setView("fleet");
    setSelected(id);
    setDetail(null);
    setHistory([]);
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
    setFleet(null);
    setCredential(null);
    setDetail(null);
    setEvents([]);
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
      </HostApiProvider>
    );
  }
  return (
    <div className="fleet-shell">
      <aside className="fleet-sidebar">
        <div className="fleet-brand">
          <Gauge size={29} />
          <strong>OpsDeck</strong>
        </div>
        <p className="fleet-sidebar-caption">Runner fleet</p>
        <button
          className={view === "fleet" && !cluster ? "active" : ""}
          onClick={() => navigate("fleet", "")}
        >
          <Network size={18} />
          All clusters<span>{nodes.length}</span>
        </button>
        <div className="fleet-clusters">
          {clusters.map((c) => (
            <button
              key={c}
              className={cluster === c && view === "fleet" ? "active" : ""}
              onClick={() => navigate("fleet", c)}
            >
              <Server size={16} />
              {c}
              <span>{nodes.filter((n) => n.cluster === c).length}</span>
            </button>
          ))}
        </div>
        <nav aria-label="Host workspace navigation">
          {[...new Set(hostPages.map((p) => p.group))].map((group) => (
            <div className="fleet-host-nav" key={group}>
              <span>{group}</span>
              {hostPages
                .filter((p) => p.group === group)
                .map((p) => (
                  <button
                    key={p.id}
                    aria-label={p.title}
                    onClick={() => openSection(p.id)}
                  >
                    <p.icon size={17} />
                    {p.title}
                  </button>
                ))}
            </div>
          ))}
        </nav>
        <button
          className={view === "enroll" ? "active" : ""}
          onClick={() => navigate("enroll")}
        >
          <Plus size={18} />
          Enroll host
        </button>
        <button
          className={view === "audit" ? "active" : ""}
          onClick={() => navigate("audit")}
        >
          <Activity size={18} />
          Fleet audit
        </button>
        <div className="fleet-sidebar-bottom">
          <p>
            <ShieldCheck size={16} />
            Monitoring enabled
          </p>
          <small>History retained for {fleet?.retention_days ?? 30} days</small>
          <button onClick={signOut}>
            <LogOut size={16} />
            Sign out
          </button>
        </div>
      </aside>
      <div className="fleet-body">
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
                <NodeDetail
                  key={selected}
                  detail={detail}
                  history={history}
                  hours={hours}
                  onHours={(v) => {
                    setHours(v);
                    setHistory([]);
                  }}
                />
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
