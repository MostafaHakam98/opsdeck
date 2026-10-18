import { type Scope, type WorkloadView, defaultScope } from "./useWorkloads";
export function ScopeControls({
  scope,
  setScope,
  view,
  error,
}: {
  scope: Scope;
  setScope: (scope: Scope) => void;
  view?: WorkloadView;
  error: string;
}) {
  const projects = view?.catalog.projects || [],
    pipelines = view?.catalog.pipelines || [];
  const images = (view?.catalog.images || []).filter(
    (row) =>
      (scope.project === "all" || row.projects.includes(scope.project)) &&
      (scope.pipeline === "all" || row.pipelines.includes(scope.pipeline)),
  );
  const filtered =
    scope.project !== defaultScope.project ||
    scope.pipeline !== defaultScope.pipeline ||
    scope.image !== defaultScope.image ||
    scope.hours !== defaultScope.hours;
  return (
    <section
      className={`scope-controls ${filtered ? "filtered" : ""}`}
      aria-label="Dashboard scope"
    >
      <div className="scope-fields">
        <label>
          Repository
          <select
            aria-label="Repository scope"
            value={scope.project}
            onChange={(e) =>
              setScope({
                ...scope,
                project: e.target.value,
                pipeline: "all",
                image: "all",
              })
            }
          >
            <option value="all">All repositories</option>
            {scope.project !== "all" &&
              !projects.some((row) => row.id === scope.project) && (
                <option value={scope.project}>
                  Selected repository ({scope.project})
                </option>
              )}
            {projects.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Pipeline
          <select
            aria-label="Pipeline scope"
            value={scope.pipeline}
            onChange={(e) =>
              setScope({ ...scope, pipeline: e.target.value, image: "all" })
            }
          >
            <option value="all">All observed pipelines</option>
            {scope.pipeline !== "all" &&
              !pipelines.some((row) => row.key === scope.pipeline) && (
                <option value={scope.pipeline}>{scope.pipeline}</option>
              )}
            {pipelines.map((row) => (
              <option key={row.key} value={row.key}>
                #{row.id} · {row.project}
              </option>
            ))}
          </select>
        </label>
        <label>
          Image
          <select
            aria-label="Image scope"
            value={scope.image}
            onChange={(e) => setScope({ ...scope, image: e.target.value })}
          >
            <option value="all">All images</option>
            {scope.image !== "all" &&
              !images.some((row) => row.key === scope.image) && (
                <option value={scope.image}>{scope.image.slice(0, 32)}</option>
              )}
            {images.map((row) => (
              <option key={row.key} value={row.key}>
                {row.tags?.join(", ") || row.key.slice(0, 24)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Evidence window
          <select
            aria-label="Evidence window"
            value={scope.hours}
            onChange={(e) =>
              setScope({
                ...scope,
                hours: Number(e.target.value),
                pipeline: "all",
              })
            }
          >
            <option value={24}>Last 24 hours observed</option>
            <option value={168}>Last 7 days observed</option>
            <option value={720}>Last 30 days observed</option>
            <option value={0}>All retained observations</option>
          </select>
        </label>
        <button
          className="secondary"
          disabled={!filtered}
          onClick={() => setScope(defaultScope)}
        >
          Reset scope
        </button>
      </div>
      <p>
        {filtered
          ? "Filtered: workload tables show only the selected evidence. "
          : ""}
        Hardware charts and shared worker limits always describe the whole node.
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </section>
  );
}
export function WorkloadSummary({ view }: { view?: WorkloadView }) {
  const data = view?.summary;
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>Workload in selected scope</h2>
        <span>Live observations and retained pipeline results</span>
      </div>
      <div className="workload-summary">
        {[
          ["Repositories", data?.projects],
          ["Running CI containers", data?.running_containers],
          ["Observed jobs", data?.observed_jobs],
          ["Pipelines", data?.pipelines],
          ["Known successful", data?.successful_pipelines],
          ["Unknown outcomes", data?.unknown_outcomes],
        ].map(([name, value]) => (
          <div key={name}>
            <span>{name}</span>
            <strong>{value ?? "—"}</strong>
          </div>
        ))}
      </div>
      <p className="panel-description">
        {view?.coverage.note || "Waiting for workload observations."}
      </p>
      {view?.coverage.truncated && (
        <p className="panel-description regression">
          The retained evidence exceeds this view’s 10,000-record bound. Narrow
          the evidence window; counts cover the loaded sample.
        </p>
      )}
    </section>
  );
}
