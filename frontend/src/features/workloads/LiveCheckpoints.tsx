import { PaginatedList } from "../../components/PaginatedList";
import { useEffect, useState } from "react";
import { api, bytes, download, duration } from "../../lib/api";
import { Pager } from "../../components/Pager";
import { type Scope, type WorkloadView } from "./useWorkloads";
import { WorkloadSummary } from "./ScopeControls";
type Checkpoint = {
  id: string;
  title: string;
  notes: string;
  created_at: number;
  scope: Scope;
  summary: Record<string, number | null>;
  resources?: Record<string, number | null>;
  source_health?: Record<string, any>;
  coverage?: any;
};
export function LiveCheckpoints({
  token,
  scope,
  view,
  onChanged,
}: {
  token: string;
  scope: Scope;
  view?: WorkloadView;
  onChanged: () => void;
}) {
  const [rows, setRows] = useState<Checkpoint[]>([]),
    [title, setTitle] = useState(""),
    [notes, setNotes] = useState(""),
    [query, setQuery] = useState(""),
    [onlyScope, setOnlyScope] = useState(false),
    [page, setPage] = useState(1),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [baseline, setBaseline] = useState(""),
    [result, setResult] = useState(""),
    [comparison, setComparison] = useState<{
      before: Checkpoint;
      after: Checkpoint;
      note: string;
    }>();
  async function load() {
    setRows(await api<Checkpoint[]>("checkpoints", token));
  }
  useEffect(() => {
    const controller = new AbortController();
    void api<Checkpoint[]>("checkpoints", token, undefined, controller.signal)
      .then(setRows)
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [token]);
  const sameScope = (value: Scope) =>
    value.project === scope.project &&
    value.pipeline === scope.pipeline &&
    value.image === scope.image &&
    value.hours === scope.hours;
  const filtered = rows.filter(
    (row) =>
      (!onlyScope || sameScope(row.scope)) &&
      `${row.title} ${row.notes}`.toLowerCase().includes(query.toLowerCase()),
  );
  const current = Math.min(page, Math.max(1, Math.ceil(filtered.length / 10)));
  const before = baseline || rows.at(-1)?.id || "",
    after = result || rows[0]?.id || "";
  const metrics = [
    {
      name: "Node CPU utilization",
      group: "resources",
      key: "cpu_percent",
      format: (v: any) => (v == null ? "—" : `${v.toFixed(1)}%`),
    },
    {
      name: "Node memory utilization",
      group: "resources",
      key: "memory_percent",
      format: (v: any) => (v == null ? "—" : `${v.toFixed(1)}%`),
    },
    {
      name: "Node available memory",
      group: "resources",
      key: "memory_available_bytes",
      format: bytes,
    },
    {
      name: "Shared runner job limit",
      group: "resources",
      key: "runner_concurrent",
    },
    {
      name: "Scoped running CI containers",
      group: "summary",
      key: "running_containers",
    },
    { name: "Scoped observed jobs", group: "summary", key: "observed_jobs" },
    { name: "Scoped pipelines", group: "summary", key: "pipelines" },
    {
      name: "Known successful pipelines",
      group: "summary",
      key: "successful_pipelines",
    },
    {
      name: "Known failed pipelines",
      group: "summary",
      key: "failed_pipelines",
    },
    {
      name: "Unknown pipeline outcomes",
      group: "summary",
      key: "unknown_outcomes",
    },
    {
      name: "Median successful pipeline duration",
      group: "summary",
      key: "median_success_duration",
      format: duration,
    },
    {
      name: "Successful pipelines with timing",
      group: "summary",
      key: "timed_successful_pipelines",
    },
  ];
  return (
    <>
      <WorkloadSummary view={view} />
      <section className="panel">
        <div className="panel-heading">
          <h2>Live survey checkpoints</h2>
          <span>Capture the current repository / pipeline / image scope</span>
        </div>
        <div className="operator-body">
          <p>
            Live observations refresh automatically. Save a named checkpoint
            before or after a change to retain current resources, source
            freshness and pipeline evidence. Checkpoints are observations, not
            synthetic benchmark runs.
          </p>
          {error && (
            <p role="alert" className="notice error">
              {error}
            </p>
          )}
          {message && (
            <p role="status" className="notice">
              {message}
            </p>
          )}
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              try {
                const saved = await api<Checkpoint>("checkpoints", token, {
                  title,
                  notes,
                  scope,
                });
                setMessage(`Checkpoint saved: ${saved.title}`);
                setTitle("");
                setNotes("");
                await load();
                setResult(saved.id);
                onChanged();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              Checkpoint name
              <input
                required
                aria-label="Checkpoint name"
                maxLength={160}
                placeholder="Before increasing worker capacity"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <label>
              Change or observation notes
              <textarea
                aria-label="Checkpoint notes"
                maxLength={4000}
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="What changed, workload differences, or things to verify"
              />
            </label>
            <button className="primary" disabled={busy || !title.trim()}>
              Save current checkpoint
            </button>
          </form>
        </div>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <h2>Checkpoint history</h2>
          <span>Latest 200 retained checkpoints</span>
        </div>
        <div className="table-toolbar">
          <input
            aria-label="Search checkpoints"
            placeholder="Search checkpoint names or notes"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
          />
          <label>
            <input
              type="checkbox"
              checked={onlyScope}
              onChange={(e) => {
                setOnlyScope(e.target.checked);
                setPage(1);
              }}
            />{" "}
            Current scope only
          </label>
        </div>
        {filtered.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Checkpoint</th>
                  <th>Captured</th>
                  <th>Repository / pipeline / image</th>
                  <th>Pipeline evidence</th>
                  <th>Export</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice((current - 1) * 10, current * 10).map((row) => (
                  <tr key={row.id}>
                    <td>
                      {row.title}
                      <small>{row.notes}</small>
                    </td>
                    <td>{new Date(row.created_at * 1000).toLocaleString()}</td>
                    <td>
                      {row.scope.project === "all"
                        ? "All repositories"
                        : view?.catalog.projects.find(
                            (project) => project.id === row.scope.project,
                          )?.name || row.scope.project}
                      <small>
                        Pipeline {row.scope.pipeline} · Image{" "}
                        {row.scope.image.slice(0, 24)}
                      </small>
                    </td>
                    <td>
                      {row.summary.successful_pipelines} successful /{" "}
                      {row.summary.unknown_outcomes} unknown
                      <small>{row.summary.pipelines} retained pipelines</small>
                    </td>
                    <td>
                      <button
                        disabled={busy}
                        onClick={async () => {
                          setBusy(true);
                          try {
                            const value = await api(
                              `checkpoints/${row.id}`,
                              token,
                            );
                            download(
                              `opsdeck-checkpoint-${row.id}.json`,
                              JSON.stringify(value, null, 2),
                              "application/json",
                            );
                          } catch (e) {
                            setError((e as Error).message);
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        Export checkpoint
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty">
            <p>
              No checkpoints match. Save the current survey to begin a
              comparison.
            </p>
          </div>
        )}
        <Pager
          total={filtered.length}
          page={current}
          size={10}
          onPage={setPage}
        />
      </section>
      <section className="panel">
        <div className="panel-heading">
          <h2>Compare checkpoints</h2>
          <span>Matching scope required</span>
        </div>
        <div className="operator-body">
          <div className="operator-fields">
            <label>
              Baseline checkpoint
              <select
                aria-label="Baseline checkpoint"
                value={before}
                onChange={(e) => {
                  setBaseline(e.target.value);
                  setComparison(undefined);
                }}
              >
                <option value="">Choose baseline</option>
                {rows.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.title} ·{" "}
                    {new Date(row.created_at * 1000).toLocaleString()}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Result checkpoint
              <select
                aria-label="Result checkpoint"
                value={after}
                onChange={(e) => {
                  setResult(e.target.value);
                  setComparison(undefined);
                }}
              >
                <option value="">Choose result</option>
                {rows.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.title} ·{" "}
                    {new Date(row.created_at * 1000).toLocaleString()}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button
            disabled={busy || !before || !after || before === after}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                setComparison(
                  await api(
                    `checkpoints/compare?baseline=${before}&result=${after}`,
                    token,
                  ),
                );
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Compare saved checkpoints
          </button>
        </div>
        {comparison && (
          <>
            <PaginatedList
              items={metrics as any[]}
              label="Checkpoint measurements"
              resetKey={`${comparison.before.id}:${comparison.after.id}`}
            >
              {(pageRows) => (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Measurement</th>
                        <th>{comparison.before.title}</th>
                        <th>{comparison.after.title}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pageRows.map((metric) => (
                        <tr key={metric.key}>
                          <td>{metric.name}</td>
                          {[comparison.before, comparison.after].map((row) => {
                            const value = (row as any)[metric.group]?.[
                              metric.key
                            ];
                            return (
                              <td key={row.id}>
                                {metric.format
                                  ? metric.format(value)
                                  : (value ?? "—")}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </PaginatedList>
            <p className="panel-description">{comparison.note}</p>
          </>
        )}
      </section>
    </>
  );
}
