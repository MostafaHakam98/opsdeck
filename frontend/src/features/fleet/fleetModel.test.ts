import { describe, expect, it } from "vitest";
import {
  backoffDelay,
  csvCell,
  deriveAlerts,
  deriveSummary,
  displayState,
  filterAlerts,
  filterNodes,
  fleetAlerts,
  fleetSummary,
  groupByCluster,
  heatColor,
  heatLevel,
  hostsCsv,
  pulseRowLabel,
  pulseStats,
  relativeAge,
  sortNodes,
  sparklinePath,
  stateSegments,
  toCsv,
} from "./fleetModel";
import type { Fleet, Node } from "./types";

function node(overrides: Partial<Node> & { id: string }): Node {
  return {
    name: overrides.id,
    cluster: "alpha",
    hostname: `${overrides.id}.local`,
    scope: "native",
    status: "online",
    last_seen: 1000,
    collected_at: 1000,
    age_seconds: 5,
    metrics: { cpu: 10, memory: 20, gpu: null, ci_running: 1 },
    source_status: {},
    notes: "",
    maintenance: false,
    ...overrides,
  };
}

describe("heat mapping", () => {
  it("maps 0..100 onto six steps aligned with alert thresholds", () => {
    expect(heatLevel(0)).toBe(0);
    expect(heatLevel(19.9)).toBe(0);
    expect(heatLevel(20)).toBe(1);
    expect(heatLevel(59)).toBe(2);
    expect(heatLevel(79.9)).toBe(3);
    expect(heatLevel(80)).toBe(4);
    expect(heatLevel(90)).toBe(5);
    expect(heatLevel(140)).toBe(5);
  });
  it("keeps missing data distinct from idle", () => {
    expect(heatLevel(null)).toBeNull();
    expect(heatLevel(Number.NaN)).toBeNull();
    expect(heatColor(null)).toBe("var(--heat-empty)");
    expect(heatColor(0)).toBe("var(--heat-0)");
    expect(heatColor(95)).toBe("var(--heat-5)");
  });
});

describe("filtering and sorting", () => {
  const nodes = [
    node({ id: "b", metrics: { cpu: 50 }, notes: "GPU bay 3" }),
    node({ id: "a", cluster: "beta", metrics: { cpu: null } }),
    node({ id: "c", status: "offline", metrics: { cpu: 90 } }),
    node({ id: "d", maintenance: true, metrics: { cpu: 5 } }),
  ];
  it("matches name, hostname, cluster and notes", () => {
    const f = (query: string) =>
      filterNodes(nodes, { query, state: "", cluster: "" }).map((n) => n.id);
    expect(f("bay 3")).toEqual(["b"]);
    expect(f("BETA")).toEqual(["a"]);
    expect(f("c.local")).toEqual(["c"]);
  });
  it("filters by display state and cluster", () => {
    expect(
      filterNodes(nodes, { query: "", state: "maintenance", cluster: "" }).map(
        (n) => n.id,
      ),
    ).toEqual(["d"]);
    expect(
      filterNodes(nodes, { query: "", state: "online", cluster: "alpha" }).map(
        (n) => n.id,
      ),
    ).toEqual(["b"]);
  });
  it("sorts numerically with missing values last in both directions", () => {
    expect(sortNodes(nodes, "cpu", "desc").map((n) => n.id)).toEqual([
      "c",
      "b",
      "d",
      "a",
    ]);
    expect(sortNodes(nodes, "cpu", "asc").map((n) => n.id)).toEqual([
      "d",
      "b",
      "c",
      "a",
    ]);
  });
  it("sorts by name and attention-first status", () => {
    expect(sortNodes(nodes, "name", "asc").map((n) => n.id)).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
    expect(sortNodes(nodes, "status", "asc")[0].id).toBe("c");
  });
  it("groups by cluster alphabetically", () => {
    expect(
      groupByCluster(nodes).map((g) => [g.cluster, g.nodes.length]),
    ).toEqual([
      ["alpha", 3],
      ["beta", 1],
    ]);
  });
  it("shows maintenance instead of connection state, but not over revoked", () => {
    expect(displayState(node({ id: "x", maintenance: true }))).toBe(
      "maintenance",
    );
    expect(
      displayState(node({ id: "x", maintenance: true, status: "revoked" })),
    ).toBe("revoked");
    expect(
      stateSegments(nodes).map((s) => [s.state, s.count, s.share]),
    ).toEqual([
      ["online", 2, 0.5],
      ["offline", 1, 0.25],
      ["maintenance", 1, 0.25],
    ]);
  });
});

describe("client-side alert and summary fallback", () => {
  const nodes = [
    node({ id: "hot", metrics: { cpu: 95, memory: 82, io_pressure: 12 } }),
    node({ id: "quiet", metrics: { cpu: 10, memory: 10 } }),
    node({ id: "gone", status: "offline" }),
    node({ id: "late", status: "stale" }),
    node({ id: "fresh", status: "waiting", metrics: { cpu: 99 } }),
    node({ id: "paused", maintenance: true, metrics: { cpu: 99 } }),
    node({ id: "cut", status: "revoked", metrics: { cpu: 99 } }),
    node({ id: "src", source_status: { docker: "degraded", gpu: "healthy" } }),
  ];
  it("applies the backend thresholds and skips maintenance and revoked hosts", () => {
    const alerts = deriveAlerts(nodes);
    expect(alerts.map((a) => `${a.node_name}:${a.kind}:${a.severity}`)).toEqual(
      [
        "gone:offline:critical",
        "hot:cpu:critical",
        "hot:io_pressure:warning",
        "hot:memory:warning",
        "late:stale:warning",
        "src:source:warning",
      ],
    );
    expect(alerts.find((a) => a.kind === "cpu")?.value).toBe(95);
    expect(alerts.find((a) => a.kind === "source")?.title).toBe(
      "Docker source degraded",
    );
    expect(
      deriveAlerts([
        node({ id: "gone", status: "offline", metrics: { cpu: 99 } }),
      ]).map((a) => a.kind),
    ).toEqual(["offline"]);
  });
  it("uses the agent message as detail and skips ignored sources", () => {
    const alerts = deriveAlerts([
      node({
        id: "daos",
        source_status: {
          docker: "unavailable",
          runner: "unavailable",
          services: "degraded",
        },
        source_messages: { docker: "Docker API did not answer within 10s" },
        ignored_sources: ["runner"],
      }),
    ]);
    expect(alerts.map((a) => [a.title, a.detail])).toEqual([
      ["Docker source unavailable", "Docker API did not answer within 10s"],
      [
        "Services source degraded",
        "The Services collector reported degraded. Open the host to read the source message.",
      ],
    ]);
  });
  it("summarises online hosts only", () => {
    const summary = deriveSummary(nodes, deriveAlerts(nodes));
    expect(summary.hosts).toBe(8);
    expect(summary.online).toBe(4);
    expect(summary.maintenance).toBe(1);
    expect(summary.avg_cpu).toBeCloseTo((95 + 10 + 99 + 10) / 4);
    expect(summary.avg_gpu).toBeNull();
    expect(summary.alerts_critical).toBe(2);
    expect(summary.alerts_warning).toBe(4);
  });
  it("prefers server values and scopes clusters locally", () => {
    const fleet: Fleet = {
      nodes: [
        node({ id: "a", metrics: { cpu: 95 } }),
        node({ id: "b", cluster: "beta", metrics: { cpu: 10 } }),
      ],
      server_time: 0,
      retention_days: 30,
    };
    expect(fleetAlerts(fleet)).toHaveLength(1);
    expect(fleetSummary(fleet)?.hosts).toBe(2);
    expect(fleetSummary(fleet, "beta")?.alerts_critical).toBe(0);
    const server = {
      ...fleet,
      alerts: [],
      summary: { ...deriveSummary([], []), hosts: 42 },
    };
    expect(fleetAlerts(server)).toEqual([]);
    expect(fleetSummary(server)?.hosts).toBe(42);
    expect(fleetSummary(server, "beta")?.hosts).toBe(1);
    expect(filterAlerts(fleetAlerts(fleet), "", "CPU")).toHaveLength(1);
    expect(filterAlerts(fleetAlerts(fleet), "beta", "")).toHaveLength(0);
  });
});

describe("pulse helpers", () => {
  it("summarises a row and labels it for screen readers", () => {
    const stats = pulseStats([null, 20, 88, null, 42, null]);
    expect(stats).toEqual({ current: 42, peak: 88, average: 50 });
    expect(pulseRowLabel("build-01", "cpu", 42, stats, 60)).toBe(
      "build-01, CPU now 42%, peak 88% in the last hour",
    );
    expect(
      pulseRowLabel("build-02", "gpu", null, pulseStats([null]), 1440),
    ).toBe("build-02, GPU now no data, no samples in the last 24 hours");
  });
  it("draws sparklines with gaps for missing samples", () => {
    expect(sparklinePath([], 100, 20)).toBe("");
    expect(sparklinePath([0, 100], 100, 20)).toBe("M0 20 L100 0");
    expect(sparklinePath([50, null, 50, 50, null], 40, 20)).toBe(
      "M0 10 h0 M20 10 L30 10",
    );
  });
});

describe("export and timing", () => {
  it("escapes CSV and neutralises formula-like text", () => {
    expect(csvCell('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(csvCell("=cmd()")).toBe("'=cmd()");
    expect(csvCell(-3)).toBe("-3");
    expect(csvCell(null)).toBe("");
    expect(toCsv(["a", "b"], [[1, "x\ny"]])).toBe('a,b\r\n1,"x\ny"\r\n');
  });
  it("exports hosts with current metrics", () => {
    const csv = hostsCsv([
      node({ id: "a", notes: "rack 2", metrics: { cpu: 12.345 } }),
    ]);
    expect(csv.split("\r\n")[1]).toMatch(
      /^a,a\.local,alpha,online,no,12\.3,,,,5,1970-01-01T00:16:40\.000Z,rack 2$/,
    );
  });
  it("backs off exponentially to one minute", () => {
    expect([0, 1, 2, 3, 4, 9].map((n) => backoffDelay(n))).toEqual([
      10000, 10000, 20000, 40000, 60000, 60000,
    ]);
  });
  it("formats relative ages", () => {
    expect(relativeAge(null)).toBe("Never");
    expect(relativeAge(2)).toBe("just now");
    expect(relativeAge(42)).toBe("42s ago");
    expect(relativeAge(301)).toBe("5m ago");
    expect(relativeAge(7200)).toBe("2h ago");
    expect(relativeAge(200000)).toBe("2d ago");
  });
});
