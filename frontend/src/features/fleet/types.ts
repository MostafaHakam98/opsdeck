import type { Source } from "../../lib/api";

export type NodeStatus = "waiting" | "online" | "stale" | "offline" | "revoked";
export type Node = {
  id: string;
  name: string;
  cluster: string;
  hostname: string | null;
  scope: string | null;
  status: NodeStatus;
  last_seen: number | null;
  collected_at: number | null;
  age_seconds: number | null;
  metrics: Record<string, number | null>;
  source_status: Record<string, string>;
  /** Added by the command-center backend; absent on older servers. */
  notes?: string;
  maintenance?: boolean;
};
export type Summary = {
  hosts: number;
  online: number;
  waiting: number;
  stale: number;
  offline: number;
  revoked: number;
  maintenance: number;
  clusters: number;
  ci_running: number | null;
  avg_cpu: number | null;
  avg_memory: number | null;
  avg_gpu: number | null;
  alerts_critical: number;
  alerts_warning: number;
};
export type Alert = {
  key: string;
  node_id: string;
  node_name: string;
  cluster: string;
  severity: "critical" | "warning";
  kind: string;
  title: string;
  detail: string;
  value: number | null;
};
export type Fleet = {
  nodes: Node[];
  server_time: number;
  retention_days: number;
  summary?: Summary;
  alerts?: Alert[];
  version?: string;
};
export type PulseMetric = "cpu" | "memory" | "gpu";
export type PulseSeries = Record<PulseMetric, (number | null)[]>;
export type Pulse = {
  start: number;
  end: number;
  bucket_seconds: number;
  nodes: Record<string, PulseSeries>;
};
export type FleetPoint = {
  ts: number;
  cpu: number | null;
  cpu_peak: number | null;
  memory: number | null;
  memory_peak: number | null;
  gpu: number | null;
  ci_running: number | null;
  hosts: number | null;
};
export type Detail = {
  workspace_connected?: boolean;
  node: Node;
  sources: Record<string, Source>;
  server_time: number;
};
export type Credential = {
  id: string;
  name?: string;
  cluster?: string;
  token: string;
};
export type Point = { ts: number; [key: string]: number | null };
