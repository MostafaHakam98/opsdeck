import { PaginatedList } from "../../components/PaginatedList";
import { useState } from "react";
import { Download } from "lucide-react";
import { download, duration } from "../../lib/api";
import {
  changeLabel,
  compareTiming,
  reportMarkdown,
  timingRows,
  type Benchmark,
} from "./benchmarks";
import { tone } from "../../components/Status";

export function SpeedupReport({ archive }: { archive: any }) {
  const measured: Benchmark[] = archive.benchmarks.filter(
    (row: Benchmark) => row.runner_seconds != null,
  );
  const [baseline, setBaseline] = useState<number | null>(null);
  const [result, setResult] = useState<number | null>(null);
  if (!measured.length) return null;
  const before =
    measured.find((row) => row.pipeline_id === baseline) || measured[0];
  const after =
    measured.find((row) => row.pipeline_id === result) ||
    measured[measured.length - 1];
  const execution = compareTiming(before.wall_seconds, after.wall_seconds);
  const work = compareTiming(before.runner_seconds, after.runner_seconds);
  const from = measured.indexOf(before),
    to = measured.indexOf(after);
  const regressions = archive.job_comparisons.filter(
    (job: any) =>
      (compareTiming(job.seconds[from], job.seconds[to])?.savedSeconds ?? 0) <
      0,
  );
  const verified = archive.optimizations.filter(
    (item: any) => item.current_check?.status === "verified",
  ).length;
  return (
    <section className="panel speedup-report">
      <div className="panel-heading">
        <h2>Measured speedup report</h2>
        <button
          className="secondary"
          onClick={() =>
            download(
              "opsdeck-speedup-report.md",
              reportMarkdown(archive, before, after),
              "text/markdown",
            )
          }
        >
          <Download size={16} />
          Download speedup report
        </button>
      </div>
      <div className="comparison-controls">
        <label>
          Compare baseline
          <select
            aria-label="Compare baseline"
            value={before.pipeline_id}
            onChange={(e) => setBaseline(Number(e.target.value))}
          >
            {measured.map((row) => (
              <option key={row.pipeline_id} value={row.pipeline_id}>
                #{row.pipeline_id} · {row.label} · {row.status}
              </option>
            ))}
          </select>
        </label>
        <label>
          Compare result
          <select
            aria-label="Compare result"
            value={after.pipeline_id}
            onChange={(e) => setResult(Number(e.target.value))}
          >
            {measured.map((row) => (
              <option key={row.pipeline_id} value={row.pipeline_id}>
                #{row.pipeline_id} · {row.label} · {row.status}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="speedup-cards">
        <div>
          <span>Execution speedup</span>
          <strong
            className={
              execution?.factor == null
                ? ""
                : execution.factor >= 1
                  ? "tone-good"
                  : "tone-bad"
            }
          >
            {execution?.factor == null
              ? "n/a"
              : `${execution.factor.toFixed(2)}×`}
          </strong>
          <p>
            {duration(before.wall_seconds)} → {duration(after.wall_seconds)}
          </p>
          <small>{changeLabel(execution)} · excludes queue</small>
        </div>
        <div>
          <span>Runner work reduction</span>
          <strong
            className={
              work?.reductionPercent == null
                ? ""
                : work.reductionPercent >= 0
                  ? "tone-good"
                  : "tone-bad"
            }
          >
            {work?.reductionPercent == null
              ? "n/a"
              : `${work.reductionPercent.toFixed(1)}%`}
          </strong>
          <p>
            {duration(before.runner_seconds)} → {duration(after.runner_seconds)}
          </p>
          <small>{changeLabel(work)} · summed job durations</small>
        </div>
        <div>
          <span>Jobs slower in this comparison</span>
          <strong className={regressions.length ? "tone-warn" : "tone-good"}>
            {regressions.length}
          </strong>
          <p>
            {regressions.length
              ? regressions.map((job: any) => job.name).join(", ")
              : "No regressions in recorded job comparisons"}
          </p>
          <small>Read job notes for cold-cache and workload caveats</small>
        </div>
        <div>
          <span>Optimizations verified on this host</span>
          <strong
            className={
              verified === archive.optimizations.length
                ? "tone-good"
                : "tone-warn"
            }
          >
            {verified}/{archive.optimizations.length}
          </strong>
          <p>Current independent checks</p>
          <small>
            Other changes require repository or administrator evidence
          </small>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Metric</th>
              <th>Before · #{before.pipeline_id}</th>
              <th>After · #{after.pipeline_id}</th>
              <th>Time saved / increase</th>
            </tr>
          </thead>
          <tbody>
            {timingRows(before, after).map((row) => (
              <tr key={row.name}>
                <td>{row.name}</td>
                <td>{duration(row.before)}</td>
                <td>{duration(row.after)}</td>
                <td
                  className={
                    (row.comparison?.savedSeconds ?? 0) < 0 ? "regression" : ""
                  }
                >
                  {changeLabel(row.comparison)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="panel-description">
        Queue + execution is a derived total. An execution speedup can be offset
        by queue wait. Summed job time measures runner work; it does not
        establish throughput or identify which individual optimization caused
        the improvement.
      </p>
      {regressions.length > 0 && (
        <PaginatedList
          items={regressions as any[]}
          label="Job regressions"
          initialSize={10}
          resetKey={`${before.pipeline_id}:${after.pipeline_id}`}
        >
          {(pageRows) => (
            <>
              {pageRows.map((job: any) => (
                <p className="panel-description regression" key={job.name}>
                  <strong>{job.name}:</strong>{" "}
                  {changeLabel(
                    compareTiming(job.seconds[from], job.seconds[to]),
                  )}
                  . {job.note || "No cause recorded."}
                </p>
              ))}
            </>
          )}
        </PaginatedList>
      )}
      {archive.measurements?.length > 0 && (
        <>
          <div className="panel-heading">
            <h3>Other survey measurements and projections</h3>
          </div>
          <PaginatedList
            items={archive.measurements as any[]}
            label="Survey measurements"
          >
            {(pageRows) => (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Finding</th>
                      <th>Before</th>
                      <th>After / target</th>
                      <th>Evidence type</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((item: any) => (
                      <tr key={item.title}>
                        <td>
                          <strong>{item.title}</strong>
                          <small>{item.evidence}</small>
                        </td>
                        <td>{item.before || "Not recorded"}</td>
                        <td>
                          {item.after}
                          <small>{item.note}</small>
                        </td>
                        <td>
                          <span className={`badge ${tone(item.kind)}`}>
                            <i />
                            {item.kind}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </PaginatedList>
        </>
      )}
    </section>
  );
}
