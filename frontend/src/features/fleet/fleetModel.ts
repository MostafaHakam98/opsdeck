/** Pure fleet logic shared by the command center views. No React, no DOM. */
import type {
  Alert,
  Fleet,
  Node,
  NodeStatus,
  Pulse,
  PulseMetric,
  Summary,
} from "./types";

export type DisplayState = NodeStatus | "maintenance";
export const DISPLAY_STATES: DisplayState[] = [
  "online",
  "stale",
  "offline",
  "waiting",
  "maintenance",
  "revoked",
];
export const STATE_LABELS: Record<DisplayState, string> = {
  online: "Online",
  stale: "Stale",
  offline: "Offline",
  waiting: "Waiting",
  maintenance: "Maintenance",
  revoked: "Revoked",
};
export const METRIC_LABELS: Record<PulseMetric, string> = {
  cpu: "CPU",
  memory: "Memory",
  gpu: "GPU",
};

/** Maintenance hides the connection state, except for revoked agents. */
export function displayState(node: Node): DisplayState {
  return node.maintenance && node.status !== "revoked"
    ? "maintenance"
    : node.status;
}

export function stateCounts(nodes: Node[]): Record<DisplayState, number> {
  const counts = Object.fromEntries(
    DISPLAY_STATES.map((s) => [s, 0]),
  ) as Record<DisplayState, number>;
  for (const node of nodes) counts[displayState(node)] += 1;
  return counts;
}

/** Proportional segments for the status strip; empty states are dropped. */
export function stateSegments(nodes: Node[]) {
  const counts = stateCounts(nodes);
  const total = nodes.length;
  return DISPLAY_STATES.filter((state) => counts[state] > 0).map((state) => ({
    state,
    count: counts[state],
    share: total ? counts[state] / total : 0,
  }));
}

/** Heat steps follow the alert thresholds: 80% warns, 90% is critical. */
const HEAT_STEPS = [20, 40, 60, 80, 90];
export function heatLevel(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const level = HEAT_STEPS.findIndex((limit) => value < limit);
  return level === -1 ? 5 : level;
}
export function heatColor(value: number | null | undefined): string {
  const level = heatLevel(value);
  return level === null ? "var(--heat-empty)" : `var(--heat-${level})`;
}
export const HEAT_LEGEND = [
  { level: 0, label: "Under 20%" },
  { level: 1, label: "20 to 40%" },
  { level: 2, label: "40 to 60%" },
  { level: 3, label: "60 to 80%" },
  { level: 4, label: "80 to 90%" },
  { level: 5, label: "90% and above" },
];

export type HostFilter = { query: string; state: string; cluster: string };
export function matchesQuery(node: Node, query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return `${node.name} ${node.hostname || ""} ${node.cluster} ${node.notes || ""}`
    .toLowerCase()
    .includes(needle);
}
export function filterNodes(nodes: Node[], filter: HostFilter): Node[] {
  return nodes.filter(
    (node) =>
      (!filter.cluster || node.cluster === filter.cluster) &&
      (!filter.state || displayState(node) === filter.state) &&
      matchesQuery(node, filter.query),
  );
}

export type SortKey =
  "name" | "cluster" | "status" | "cpu" | "memory" | "gpu" | "ci" | "last_seen";
export type SortDirection = "asc" | "desc";
const STATE_RANK: Record<DisplayState, number> = {
  offline: 0,
  stale: 1,
  waiting: 2,
  online: 3,
  maintenance: 4,
  revoked: 5,
};
function sortValue(node: Node, key: SortKey): string | number | null {
  switch (key) {
    case "name":
      return node.name.toLowerCase();
    case "cluster":
      return node.cluster.toLowerCase();
    case "status":
      return STATE_RANK[displayState(node)];
    case "cpu":
    case "memory":
    case "gpu":
      return finite(node.metrics[key]);
    case "ci":
      return finite(node.metrics.ci_running);
    case "last_seen":
      return finite(node.last_seen);
  }
}
/** Stable sort; missing values always sort last, ties fall back to name. */
export function sortNodes(
  nodes: Node[],
  key: SortKey,
  direction: SortDirection,
): Node[] {
  const sign = direction === "asc" ? 1 : -1;
  return [...nodes].sort((a, b) => {
    const left = sortValue(a, key),
      right = sortValue(b, key);
    if (left !== right) {
      if (left === null) return 1;
      if (right === null) return -1;
      const order =
        typeof left === "string" && typeof right === "string"
          ? left.localeCompare(right)
          : Number(left) - Number(right);
      if (order) return order * sign;
    }
    return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
  });
}
export function groupByCluster(nodes: Node[]) {
  const groups = new Map<string, Node[]>();
  for (const node of nodes) {
    groups.set(node.cluster, [...(groups.get(node.cluster) || []), node]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([cluster, members]) => ({ cluster, nodes: members }));
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function average(values: (number | null | undefined)[]) {
  const present = values.map(finite).filter((v): v is number => v !== null);
  return present.length
    ? present.reduce((sum, v) => sum + v, 0) / present.length
    : null;
}

const SOURCE_LABELS: Record<string, string> = {
  host: "Host",
  docker: "Docker",
  gpu: "GPU",
  runner: "Runner",
  services: "Services",
};
const ALERT_METRICS: Array<[string, string, string, number, number]> = [
  ["cpu", "High CPU load", "CPU", 80, 90],
  ["memory", "High memory use", "Memory", 80, 90],
  ["io_pressure", "High I/O pressure", "I/O pressure (avg60)", 10, 25],
];

/**
 * Client-side mirror of the backend alert rules, for older servers.
 * Offline and stale hosts report the delivery problem, not their old load.
 */
export function deriveAlerts(nodes: Node[]): Alert[] {
  const alerts: Alert[] = [];
  for (const node of nodes) {
    if (
      node.maintenance ||
      node.status === "revoked" ||
      node.status === "waiting"
    )
      continue;
    const add = (
      severity: Alert["severity"],
      kind: string,
      title: string,
      detail: string,
      value: number | null = null,
      key = kind,
    ) =>
      alerts.push({
        key: `${node.id}:${key}`,
        node_id: node.id,
        node_name: node.name,
        cluster: node.cluster,
        severity,
        kind,
        title,
        detail,
        value,
      });
    if (node.status === "offline") {
      add(
        "critical",
        "offline",
        "Agent offline",
        "Check the agent service and outbound HTTPS from the host.",
      );
      continue;
    }
    if (node.status === "stale") {
      add(
        "warning",
        "stale",
        "Telemetry stale",
        "The agent is connected; check its collectors and the host clock.",
      );
      continue;
    }
    for (const [key, title, label, warn, critical] of ALERT_METRICS) {
      const value = finite(node.metrics[key]);
      if (value === null || value < warn) continue;
      const severity = value >= critical ? "critical" : "warning";
      add(
        severity,
        key,
        title,
        `${label} at ${value.toFixed(0)}%, ${severity} threshold ${severity === "critical" ? critical : warn}%.`,
        value,
      );
    }
    const ignored = node.ignored_sources || [];
    for (const [source, status] of Object.entries(node.source_status || {})) {
      if (status !== "degraded" && status !== "unavailable") continue;
      if (ignored.includes(source)) continue;
      const label = SOURCE_LABELS[source] || source;
      add(
        "warning",
        "source",
        `${label} source ${status}`,
        node.source_messages?.[source] ||
          `The ${label} collector reported ${status}. Open the host to read the source message.`,
        null,
        `source:${source}`,
      );
    }
  }
  return sortAlerts(alerts);
}
export function sortAlerts(alerts: Alert[]) {
  return [...alerts].sort(
    (a, b) =>
      (a.severity === b.severity ? 0 : a.severity === "critical" ? -1 : 1) ||
      a.node_name.toLowerCase().localeCompare(b.node_name.toLowerCase()) ||
      a.key.localeCompare(b.key),
  );
}

export function deriveSummary(nodes: Node[], alerts: Alert[]): Summary {
  const online = nodes.filter((n) => n.status === "online");
  const ci = online
    .map((n) => finite(n.metrics.ci_running))
    .filter((v): v is number => v !== null);
  const count = (status: NodeStatus) =>
    nodes.filter((n) => n.status === status).length;
  return {
    hosts: nodes.length,
    online: online.length,
    waiting: count("waiting"),
    stale: count("stale"),
    offline: count("offline"),
    revoked: count("revoked"),
    maintenance: nodes.filter((n) => n.maintenance).length,
    clusters: new Set(nodes.map((n) => n.cluster)).size,
    ci_running: ci.length ? ci.reduce((sum, v) => sum + v, 0) : null,
    avg_cpu: average(online.map((n) => n.metrics.cpu)),
    avg_memory: average(online.map((n) => n.metrics.memory)),
    avg_gpu: average(online.map((n) => n.metrics.gpu)),
    alerts_critical: alerts.filter((a) => a.severity === "critical").length,
    alerts_warning: alerts.filter((a) => a.severity === "warning").length,
  };
}

/** Prefer server values; fall back to client derivation for older servers. */
export function fleetAlerts(fleet: Fleet | null): Alert[] {
  if (!fleet) return [];
  return Array.isArray(fleet.alerts) ? fleet.alerts : deriveAlerts(fleet.nodes);
}
/**
 * The server summary covers the whole fleet. A cluster view, or a server
 * without a summary, is summarised in the browser from the same rules.
 */
export function fleetSummary(
  fleet: Fleet | null,
  cluster = "",
): Summary | null {
  if (!fleet) return null;
  if (!cluster && fleet.summary) return fleet.summary;
  const nodes = fleet.nodes.filter((n) => !cluster || n.cluster === cluster);
  const alerts = fleetAlerts(fleet).filter(
    (a) => !cluster || a.cluster === cluster,
  );
  return deriveSummary(nodes, alerts);
}
export function filterAlerts(alerts: Alert[], cluster: string, query: string) {
  const needle = query.trim().toLowerCase();
  return alerts.filter(
    (a) =>
      (!cluster || a.cluster === cluster) &&
      (!needle ||
        `${a.node_name} ${a.cluster} ${a.title} ${a.detail}`
          .toLowerCase()
          .includes(needle)),
  );
}

export type PulseStats = {
  current: number | null;
  peak: number | null;
  average: number | null;
};
export function pulseStats(values: (number | null)[] | undefined): PulseStats {
  const present = (values || [])
    .map(finite)
    .filter((v): v is number => v !== null);
  return {
    current: present.length ? present[present.length - 1] : null,
    peak: present.length ? Math.max(...present) : null,
    average: average(present),
  };
}
export function pulseSeries(
  pulse: Pulse | null,
  nodeId: string,
  metric: PulseMetric,
): (number | null)[] {
  const values = pulse?.nodes?.[nodeId]?.[metric];
  return Array.isArray(values) ? values : [];
}
export function windowLabel(minutes: number) {
  if (minutes === 525600) return "the last year";
  if (minutes % 1440 === 0)
    return minutes === 1440
      ? "the last 24 hours"
      : `the last ${minutes / 1440} days`;
  if (minutes % 60 === 0)
    return minutes === 60 ? "the last hour" : `the last ${minutes / 60} hours`;
  return `the last ${minutes} minutes`;
}
function wholePercent(value: number | null) {
  return value === null ? "no data" : `${Math.round(value)}%`;
}
/** Screen-reader summary of one pulse wall row. */
export function pulseRowLabel(
  name: string,
  metric: PulseMetric,
  now: number | null,
  stats: PulseStats,
  minutes: number,
) {
  const label = METRIC_LABELS[metric];
  return stats.peak === null
    ? `${name}, ${label} now ${wholePercent(now)}, no samples in ${windowLabel(minutes)}`
    : `${name}, ${label} now ${wholePercent(now)}, peak ${wholePercent(stats.peak)} in ${windowLabel(minutes)}`;
}
export function bucketRange(pulse: Pulse, index: number): [number, number] {
  const start = pulse.start + index * pulse.bucket_seconds;
  return [start, start + pulse.bucket_seconds];
}
export function clockTime(seconds: number, withDate = false) {
  return new Date(seconds * 1000).toLocaleString([], {
    ...(withDate ? { month: "short", day: "numeric" } : {}),
    hour: "2-digit",
    minute: "2-digit",
  });
}
/** Pulse axis and tooltip times: clock only up to 6h, then dates, and dates alone past a month. */
export function pulseTime(seconds: number, minutes: number) {
  if (minutes <= 43200) return clockTime(seconds, minutes > 360);
  return new Date(seconds * 1000).toLocaleDateString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
/** Width of one pulse cell in words: "one minute", "24 minutes", "2.8 hours", "6.1 days". */
export function bucketLabel(seconds: number) {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return minutes <= 1 ? "one minute" : `${minutes} minutes`;
  const round = (value: number) => Number(value.toFixed(1));
  if (minutes < 1440) {
    const hours = round(minutes / 60);
    return hours === 1 ? "one hour" : `${hours} hours`;
  }
  const days = round(minutes / 1440);
  return days === 1 ? "one day" : `${days} days`;
}

/**
 * SVG path for a 0..100 series. Missing samples break the line instead of
 * being drawn as zero; isolated points become round dots.
 */
export function sparklinePath(
  values: (number | null)[],
  width: number,
  height: number,
  max = 100,
): string {
  if (!values.length) return "";
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  const parts: string[] = [];
  let drawing = false;
  values.forEach((value, i) => {
    const v = finite(value);
    if (v === null) {
      drawing = false;
      return;
    }
    const x = +(i * step).toFixed(2);
    const y = +(
      height -
      (Math.min(max, Math.max(0, v)) / max) * height
    ).toFixed(2);
    const next = finite(values[i + 1]);
    if (!drawing) {
      parts.push(`M${x} ${y}`);
      if (next === null) parts.push("h0");
    } else parts.push(`L${x} ${y}`);
    drawing = true;
  });
  return parts.join(" ");
}

export function percentText(value: number | null | undefined, digits = 1) {
  const v = finite(value);
  return v === null ? "No data" : `${v.toFixed(digits)}%`;
}
/** Short relative age such as "just now", "42s ago", "5m ago", "3h ago". */
export function relativeAge(seconds: number | null | undefined) {
  const v = finite(seconds);
  if (v === null) return "Never";
  const s = Math.max(0, Math.round(v));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** RFC 4180 CSV; text cells that look like formulas are neutralised. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = typeof value === "number" ? String(value) : String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n")
    .concat("\r\n");
}
function round(value: unknown, digits = 1) {
  const v = finite(value);
  return v === null ? null : Number(v.toFixed(digits));
}
export function hostsCsv(nodes: Node[]) {
  return toCsv(
    [
      "name",
      "hostname",
      "cluster",
      "status",
      "maintenance",
      "cpu_percent",
      "memory_percent",
      "gpu_percent",
      "ci_running",
      "last_observation_seconds",
      "last_contact",
      "notes",
    ],
    nodes.map((n) => [
      n.name,
      n.hostname,
      n.cluster,
      n.status,
      n.maintenance ? "yes" : "no",
      round(n.metrics.cpu),
      round(n.metrics.memory),
      round(n.metrics.gpu),
      round(n.metrics.ci_running),
      round(n.age_seconds, 0),
      n.last_seen === null ? null : new Date(n.last_seen * 1000).toISOString(),
      n.notes || "",
    ]),
  );
}
export type AuditEvent = {
  id: number;
  ts: number;
  kind: string;
  severity: string;
  title: string;
  detail: string;
};
export function eventsCsv(events: AuditEvent[]) {
  return toCsv(
    ["time", "kind", "severity", "title", "detail"],
    events.map((e) => [
      new Date(e.ts * 1000).toISOString(),
      e.kind,
      e.severity,
      e.title,
      e.detail,
    ]),
  );
}
export function fileStamp(date = new Date()) {
  const pad = (v: number) => String(v).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

/** Retry delay after consecutive failures: 10s, 20s, 40s, then 60s. */
export function backoffDelay(failures: number, base = 10000, max = 60000) {
  return failures <= 1 ? base : Math.min(max, base * 2 ** (failures - 1));
}

/** Storage that never throws (private windows, blocked site data). */
export function readStored(
  storage: () => Storage,
  key: string,
  fallback: string,
): string {
  try {
    return storage().getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}
export function writeStored(
  storage: () => Storage,
  key: string,
  value: string,
) {
  try {
    storage().setItem(key, value);
  } catch {
    /* Preference is optional; the page works without it. */
  }
}
