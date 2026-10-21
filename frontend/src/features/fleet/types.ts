import type { Source } from "../../lib/api";

export type Node = {
  id: string;
  name: string;
  cluster: string;
  hostname: string | null;
  scope: string | null;
  status: "waiting" | "online" | "stale" | "offline" | "revoked";
  last_seen: number | null;
  collected_at: number | null;
  age_seconds: number | null;
  metrics: Record<string, number | null>;
  source_status: Record<string, string>;
};
export type Fleet = {
  nodes: Node[];
  server_time: number;
  retention_days: number;
};
export type Detail = {
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
