import { useEffect, useState } from "react";
import { api, bytes, duration, safeUrl } from "../../lib/api";
import { Pager } from "../../components/Pager";
import { scopeQuery, type Scope, type WorkloadView } from "./useWorkloads";
import { WorkloadSummary } from "./ScopeControls";
export function WorkloadExplorer({
  token,
  scope,
  view,
  onRefresh,
  onScope,
}: {
  token: string;
  scope: Scope;
  view?: WorkloadView;
  onRefresh: () => void;
  onScope: (scope: Scope) => void;
}) {
  const [kind, setKind] = useState("pipelines"),
    [query, setQuery] = useState(""),
    [status, setStatus] = useState("all"),
    [page, setPage] = useState(1),
    [loaded, setLoaded] = useState<{ kind: string; value: WorkloadView }>(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [historyPage, setHistoryPage] = useState<number | null>(1),
    [message, setMessage] = useState("");
  useEffect(() => {
    setPage(1);
    setHistoryPage(1);
  }, [
    scope.project,
    scope.pipeline,
    scope.image,
    scope.hours,
    kind,
    query,
    status,
  ]);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const result = await api<WorkloadView>(
          `workloads?${scopeQuery(scope)}&kind=${kind}&query=${encodeURIComponent(query)}&status=${status}&page=${page}`,
          token,
          undefined,
          controller.signal,
        );
        if (!controller.signal.aborted) {
          setLoaded({ kind, value: result });
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
  }, [
    token,
    scope.project,
    scope.pipeline,
    scope.image,
    scope.hours,
    kind,
    query,
    status,
    page,
    view,
  ]);
  const data = loaded?.kind === kind ? loaded.value : undefined;
  const projectNames = new Map(
    (data?.catalog.projects || []).map((row) => [row.id, row.name]),
  );
  return (
    <>
      <WorkloadSummary view={data || view} />
      <section className="panel">
        <div className="panel-heading">
          <h2>Projects, pipelines and images</h2>
          <span>Server-paginated retained evidence</span>
        </div>
        <div className="table-toolbar">
          <select
            aria-label="Workload table"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value);
              setStatus("all");
            }}
          >
            <option value="pipelines">Pipelines</option>
            <option value="projects">Repositories</option>
            <option value="images">Images by repository</option>
            <option value="workers">Observed job containers</option>
          </select>
          <input
            aria-label="Search workload records"
            placeholder="Search repository, pipeline, job or image"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {kind === "pipelines" && (
            <select
              aria-label="Pipeline outcome"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              {[
                "all",
                "success",
                "failed",
                "running",
                "pending",
                "canceled",
                "observed_running",
                "unknown",
              ].map((value) => (
                <option key={value} value={value}>
                  {value === "all"
                    ? "All outcomes"
                    : value.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          )}
          <button
            onClick={() => {
              setQuery("");
              setStatus("all");
              setPage(1);
            }}
          >
            Reset table filters
          </button>
        </div>
        {error && (
          <p role="alert" className="notice error">
            {error}
          </p>
        )}
        {data?.rows.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {(kind === "pipelines"
                    ? [
                        "Pipeline / repository",
                        "Outcome / evidence",
                        "Duration / queue",
                        "Observed local images",
                        "Last confirmed / observed",
                      ]
                    : kind === "projects"
                      ? [
                          "Repository",
                          "Running CI containers",
                          "Observed jobs",
                          "Pipelines",
                          "Images",
                        ]
                      : kind === "images"
                        ? [
                            "Image / tags",
                            "Repository usage",
                            "Observed containers",
                            "Size",
                            "Presence",
                          ]
                        : [
                            "Container / job",
                            "Repository / pipeline",
                            "Image",
                            "Observed state",
                            "Last seen",
                          ]
                  ).map((label) => (
                    <th key={label}>{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr key={row.key || row.id}>
                    {kind === "pipelines" ? (
                      <>
                        <td>
                          <button
                            className="text-button"
                            onClick={() =>
                              onScope({
                                ...scope,
                                project: row.project_key,
                                pipeline: row.key,
                                image: "all",
                              })
                            }
                          >
                            #{row.id}
                          </button>
                          <small>{row.project}</small>
                          {row.url && (
                            <a
                              href={safeUrl(row.url)}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Open pipeline
                            </a>
                          )}
                        </td>
                        <td>
                          <span
                            className={`badge ${row.status === "success" ? "good" : row.status === "failed" ? "bad" : "muted"}`}
                          >
                            {row.status.replaceAll("_", " ")}
                          </span>
                          <small>
                            {row.outcome_known
                              ? "GitLab-confirmed status"
                              : "Runner observation; outcome unknown"}
                          </small>
                        </td>
                        <td>
                          {duration(row.duration)}
                          <small>Queue {duration(row.queued_duration)}</small>
                        </td>
                        <td>
                          {row.images.length
                            ? row.images.map((key: string) => (
                                <small key={key}>
                                  {data.catalog.images
                                    .find((image) => image.key === key)
                                    ?.tags?.join(", ") || key.slice(0, 24)}
                                </small>
                              ))
                            : "Not attributed on this node"}
                        </td>
                        <td>
                          {new Date(
                            (row.confirmed_at || row.last_seen) * 1000,
                          ).toLocaleString()}
                        </td>
                      </>
                    ) : kind === "projects" ? (
                      <>
                        <td>
                          <button
                            className="text-button"
                            onClick={() =>
                              onScope({
                                ...scope,
                                project: row.id,
                                pipeline: "all",
                                image: "all",
                              })
                            }
                          >
                            {row.name}
                          </button>
                          <small>ID {row.id}</small>
                        </td>
                        <td>{row.running_containers ?? "—"}</td>
                        <td>{row.jobs}</td>
                        <td>{row.pipelines}</td>
                        <td>{row.images}</td>
                      </>
                    ) : kind === "images" ? (
                      <>
                        <td>
                          <button
                            className="text-button"
                            onClick={() =>
                              onScope({ ...scope, image: row.key })
                            }
                          >
                            {row.tags?.join(", ") || "Untagged"}
                          </button>
                          <small>{row.id}</small>
                        </td>
                        <td>
                          {row.projects.length
                            ? row.projects.map((key: string) => (
                                <small key={key}>
                                  {projectNames.get(key) || key}
                                </small>
                              ))
                            : "Usage not observed"}
                        </td>
                        <td>{row.observed_containers}</td>
                        <td>{bytes(row.size_bytes)}</td>
                        <td>
                          {row.present
                            ? "On this node"
                            : "Historical / identity unresolved"}
                        </td>
                      </>
                    ) : (
                      <>
                        <td>
                          {row.name}
                          <small>
                            Job {row.ci_metadata?.job_id || "unknown"} ·{" "}
                            {row.ci_metadata?.job_name || ""}
                          </small>
                        </td>
                        <td>
                          {projectNames.get(row.ci_metadata?.project_key) ||
                            row.ci_metadata?.project_key}
                          <small>
                            Pipeline{" "}
                            {row.ci_metadata?.pipeline_id || "not identified"}
                          </small>
                        </td>
                        <td>{row.image}</td>
                        <td>
                          {row.state}
                          <small>Job outcome is separate</small>
                        </td>
                        <td>
                          {new Date(row.last_seen * 1000).toLocaleString()}
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty">
            <p>
              No matching retained records. Local observation starts when
              OpsDeck sees containers; connect GitLab for authoritative
              outcomes.
            </p>
          </div>
        )}
        <Pager
          total={data?.total || 0}
          page={data?.page || 1}
          size={20}
          onPage={setPage}
        />
        <p className="panel-description">
          Image usage is attributed from observed job containers, including
          helpers. A repository-looking image tag alone does not prove that
          repository used it. GitLab pipeline duration is separate from local
          container lifetime.
        </p>
        {kind === "pipelines" && (
          <div className="operator-body">
            <p>
              Import older GitLab records one page at a time for a selected
              repository. Use All retained observations to view older imported
              evidence. Earlier image usage cannot be reconstructed from
              pipeline status alone.
            </p>
            <button
              disabled={
                busy ||
                historyPage === null ||
                scope.project === "all" ||
                data?.coverage.gitlab_status === "not_configured"
              }
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  const result = await api<{
                    message: string;
                    next_page: number | null;
                    pipelines: number;
                  }>("integrations/gitlab/history", token, {
                    project: scope.project,
                    page: historyPage,
                  });
                  setHistoryPage(result.next_page);
                  setMessage(
                    `${result.pipelines} records read. ${result.message}`,
                  );
                  onRefresh();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy
                ? "Reading GitLab…"
                : historyPage === null
                  ? "All available history pages read"
                  : `Read GitLab history page ${historyPage}`}
            </button>
            {message && <p role="status">{message}</p>}
          </div>
        )}
      </section>
    </>
  );
}
