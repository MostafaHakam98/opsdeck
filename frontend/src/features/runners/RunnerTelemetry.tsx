import { type Source } from "../../lib/api";
import { tone } from "../../components/Status";

export function RunnerTelemetry({
  source,
  service,
}: {
  source?: Source;
  service?: any;
}) {
  const metrics = source?.data?.metrics || {};
  const facts = source?.data?.facts || {};
  const healthy = source?.status === "healthy" && !source.stale;
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>Runner service and metrics</h2>
        <span>No GitLab API connection required</span>
      </div>
      <div className="speedup-cards">
        <div>
          <span>Runner service</span>
          <strong className={`tone-${tone(service?.state)}`}>
            {service?.state || "Unknown"}
          </strong>
          <small>
            {service
              ? `${service.name} · ${service.substate}`
              : "Service health is unavailable"}
          </small>
        </div>
        <div>
          <span>Metrics endpoint</span>
          <strong
            className={`tone-${tone(healthy ? "healthy" : source?.stale ? "stale" : "unavailable")}`}
          >
            {healthy ? "Available" : source?.stale ? "Stale" : "Unavailable"}
          </strong>
          <small>Separate from service health and Docker activity</small>
        </div>
        <div>
          <span>Global job limit · live</span>
          <strong>
            {healthy ? (metrics.gitlab_runner_concurrent ?? "—") : "—"}
          </strong>
          <small>
            Running CI container count also includes helper containers
          </small>
        </div>
      </div>
      {!healthy && (
        <div className="notice warn">
          <div>
            <strong>Enable the runner’s local metrics exporter</strong>
            <p>{source?.message || "Waiting for runner metrics."}</p>
            <p>
              A running service can have its exporter disabled. An administrator
              can enable loopback metrics and drain/restart the runner with:
            </p>
            <code>sudo bash scripts/runner/tune-runner-host.sh metrics</code>
            <p>
              Run from the OpsDeck directory on the node. Existing jobs are
              allowed to finish; concurrency and job limits are preserved.
            </p>
          </div>
        </div>
      )}
      {facts.runners?.length > 0 ? (
        <>
          <p className="panel-description">
            Configuration snapshot:{" "}
            {facts.updated_at
              ? new Date(facts.updated_at * 1000).toLocaleString()
              : "date not recorded"}
            . Global job limit at export: {facts.concurrent ?? "unknown"}.
            Refresh the export after configuration changes.
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Registration</th>
                  <th>Executor</th>
                  <th>Job limit</th>
                  <th>Request concurrency</th>
                  <th>CPU quota</th>
                  <th>Memory ceiling</th>
                </tr>
              </thead>
              <tbody>
                {facts.runners.map((row: any) => (
                  <tr key={row.name}>
                    <td>{row.name}</td>
                    <td>{row.executor}</td>
                    <td>{row.limit === 0 ? "Global limit" : row.limit}</td>
                    <td>{row.request_concurrency}</td>
                    <td>{row.cpus ?? "Not set"}</td>
                    <td>{row.memory ?? "Not set"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <p className="panel-description">
          No sanitized configuration snapshot has been exported yet. Exact
          per-runner limits remain unknown.
        </p>
      )}
      {healthy && Object.keys(metrics).length > 0 && (
        <details className="panel-description">
          <summary>Collected runner metrics</summary>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Metric</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(metrics).map(([name, value]) => (
                  <tr key={name}>
                    <td>{name}</td>
                    <td>{String(value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Values are summed by metric name across labels. Histogram bucket
            totals are not job-duration percentiles or queue-time estimates.
          </p>
        </details>
      )}
    </section>
  );
}
