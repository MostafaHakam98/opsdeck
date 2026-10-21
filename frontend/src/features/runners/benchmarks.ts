import { duration } from "../../lib/api";

export type Benchmark = {
  pipeline_id: number;
  label: string;
  status: string;
  runner_seconds?: number | null;
  wall_seconds?: number | null;
  queue_seconds?: number | null;
};

const known = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

export function compareTiming(before: unknown, after: unknown) {
  if (!known(before) || !known(after)) return null;
  return {
    savedSeconds: before - after,
    reductionPercent: before > 0 ? ((before - after) / before) * 100 : null,
    factor: before > 0 && after > 0 ? before / after : null,
  };
}

function elapsed(run: Benchmark) {
  return known(run.wall_seconds) && known(run.queue_seconds)
    ? run.wall_seconds + run.queue_seconds
    : null;
}

export function timingRows(before: Benchmark, after: Benchmark) {
  return [
    {
      name: "Runner work (sum of job time)",
      before: before.runner_seconds,
      after: after.runner_seconds,
    },
    {
      name: "Execution wall time",
      before: before.wall_seconds,
      after: after.wall_seconds,
    },
    {
      name: "First-job queue wait",
      before: before.queue_seconds,
      after: after.queue_seconds,
    },
    {
      name: "Queue + execution (derived)",
      before: elapsed(before),
      after: elapsed(after),
    },
  ].map((row) => ({
    ...row,
    comparison: compareTiming(row.before, row.after),
  }));
}

export function changeLabel(comparison: ReturnType<typeof compareTiming>) {
  if (!comparison) return "Not measured";
  const time = duration(Math.abs(comparison.savedSeconds));
  const percent =
    comparison.reductionPercent == null
      ? ""
      : ` (${Math.abs(comparison.reductionPercent).toFixed(1)}%)`;
  return comparison.savedSeconds === 0
    ? "No change"
    : `${time} ${comparison.savedSeconds > 0 ? "saved" : "longer"}${percent}`;
}

export function reportMarkdown(
  archive: any,
  before: Benchmark,
  after: Benchmark,
) {
  const text = (value: unknown) =>
    String(value ?? "")
      .replaceAll("|", "\\|")
      .replaceAll("\n", " ");
  const measured = archive.benchmarks.filter(
    (row: Benchmark) => row.runner_seconds != null,
  );
  const from = measured.findIndex(
    (row: Benchmark) => row.pipeline_id === before.pipeline_id,
  );
  const to = measured.findIndex(
    (row: Benchmark) => row.pipeline_id === after.pipeline_id,
  );
  const lines = [
    `# ${text(archive.title)}: speedup report`,
    `Recorded: ${text(archive.recorded_on)}. Source: ${text(archive.source_name)}.`,
    `Generated: ${new Date().toISOString()}. Current host checks reflect the snapshot used for this export.`,
    `Comparison: #${before.pipeline_id} (${text(before.label)}, ${text(before.status)}) → #${after.pipeline_id} (${text(after.label)}, ${text(after.status)}).`,
    "",
    "## Measured pipeline timings",
    "",
    "| Metric | Before | After | Change | Ratio |",
    "|---|---|---|---|---|",
    ...timingRows(before, after).map(
      (row) =>
        `| ${row.name} | ${duration(row.before)} | ${duration(row.after)} | ${changeLabel(row.comparison)} | ${row.comparison?.factor == null ? "n/a" : row.comparison.factor.toFixed(2) + "×"} |`,
    ),
    "",
    "Queue + execution is derived from the two recorded timings. Execution speedup excludes queue wait; summed job time is runner work, not throughput.",
    "",
    "## Recorded pipeline outcomes",
    "",
    "| Pipeline | Label | Outcome | Runner work | Execution | Queue |",
    "|---|---|---|---|---|---|",
    ...archive.benchmarks.map(
      (row: Benchmark) =>
        `| #${row.pipeline_id} | ${text(row.label)} | ${text(row.status)} | ${duration(row.runner_seconds)} | ${duration(row.wall_seconds)} | ${duration(row.queue_seconds)} |`,
    ),
    "",
    "## Job comparisons",
    "",
    "| Job | Before | After | Change | Caveat |",
    "|---|---|---|---|---|",
    ...archive.job_comparisons.map(
      (job: any) =>
        `| ${text(job.name)} | ${duration(job.seconds[from])} | ${duration(job.seconds[to])} | ${changeLabel(compareTiming(job.seconds[from], job.seconds[to]))} | ${text(job.note)} |`,
    ),
    "",
    "## Other measurements and projections",
    "",
    ...(archive.measurements || []).map(
      (item: any) =>
        `- **${text(item.title)}** (${text(item.kind)}): ${text(item.before || "Not recorded")} → ${text(item.after)}. ${text(item.evidence)} ${text(item.note)}`,
    ),
    "",
    "## Optimization evidence and current checks",
    "",
    ...archive.optimizations.map(
      (item: any) =>
        `- **${text(item.title)}**: recorded ${text(item.recorded_status)}; current check ${text(item.current_check?.status || "not_verified")}. ${text(item.evidence)} ${text(item.current_check?.detail)}`,
    ),
    "",
    "## Caveats and follow-ups",
    "",
    ...archive.notes.map((note: string) => `- ${text(note)}`),
    "",
    `Source SHA-256: ${text(archive.source_sha256 || "Not recorded")}`,
  ];
  return lines.join("\n") + "\n";
}
