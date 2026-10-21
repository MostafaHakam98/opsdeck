import { useHostApi } from "../../lib/HostApi";
import { useEffect, useState } from "react";
export type Scope = {
  project: string;
  pipeline: string;
  image: string;
  hours: number;
};
export const defaultScope: Scope = {
  project: "all",
  pipeline: "all",
  image: "all",
  hours: 24,
};
export function scopeQuery(scope: Scope) {
  return new URLSearchParams(
    Object.entries(scope).map(([key, value]) => [key, String(value)]),
  ).toString();
}
export type WorkloadView = {
  scope: Scope;
  summary: Record<string, number | null>;
  rows: any[];
  total: number;
  page: number;
  size: number;
  catalog: { projects: any[]; pipelines: any[]; images: any[] };
  worker_metadata: Record<string, any>;
  coverage: { truncated: boolean; gitlab_status: string; note: string };
};
export function useWorkloads(token: string, scope: Scope, refresh: number) {
  const { api } = useHostApi();
  const [data, setData] = useState<WorkloadView>();
  const [error, setError] = useState("");
  useEffect(() => {
    if (!token) {
      setData(undefined);
      return;
    }
    const controller = new AbortController();
    async function load() {
      try {
        const result = await api<WorkloadView>(
          `workloads?${scopeQuery(scope)}`,
          token,
          undefined,
          controller.signal,
        );
        if (!controller.signal.aborted) {
          setData(result);
          setError("");
        }
      } catch (e) {
        if (!controller.signal.aborted) setError((e as Error).message);
      }
    }
    void load();
    const timer = window.setInterval(load, 10000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [token, scope.project, scope.pipeline, scope.image, scope.hours, refresh]);
  return { data, error };
}
export function matchesScope(
  container: any,
  scope: Scope,
  view?: WorkloadView,
) {
  const metadata =
    view?.worker_metadata[container.id] || container.ci_metadata || {};
  const project =
    metadata.project_key ||
    String(metadata.project_id || metadata.project_path || "unattributed");
  const pipeline =
    metadata.pipeline_key ||
    (metadata.pipeline_id ? `${project}:${metadata.pipeline_id}` : null);
  const image = metadata.image_key || container.image_id || container.image;
  return (
    (!scope.hours ||
      !container.last_seen ||
      container.last_seen >= Date.now() / 1000 - scope.hours * 3600) &&
    (scope.project === "all" || project === scope.project) &&
    (scope.pipeline === "all" || pipeline === scope.pipeline) &&
    (scope.image === "all" || image === scope.image)
  );
}
