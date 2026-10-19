export function numeric(values: unknown[]): number[] {
  return values.filter(
    (value): value is number =>
      typeof value === "number" && Number.isFinite(value) && value >= 0,
  );
}

/** Nearest-rank percentile: measured values only, including real zeroes. */
export function distribution(values: unknown[]) {
  const observed = numeric(values).sort((a, b) => a - b);
  if (!observed.length) return { count: 0, mean: null, peak: null, p95: null };
  return {
    count: observed.length,
    mean: observed.reduce((sum, value) => sum + value, 0) / observed.length,
    peak: observed.at(-1)!,
    p95: observed[Math.ceil(observed.length * 0.95) - 1],
  };
}

export function historyDistribution(
  points: Array<Record<string, number | null>>,
  key: string,
) {
  const stats = distribution(points.map((point) => point[key]));
  const peaks = numeric(
    points.map((point) => point[`${key}_peak`] ?? point[key]),
  );
  return { ...stats, peak: peaks.length ? Math.max(...peaks) : null };
}

export function pipelineOutcomes(pipelines: Array<{ status: string }>) {
  const groups = [
    { name: "Successful", statuses: ["success"], color: "var(--good)" },
    { name: "Failed", statuses: ["failed"], color: "var(--bad)" },
    {
      name: "In progress",
      statuses: [
        "running",
        "pending",
        "created",
        "preparing",
        "waiting_for_resource",
      ],
      color: "var(--series-1)",
    },
    {
      name: "Canceled / skipped",
      statuses: ["canceled", "skipped"],
      color: "var(--series-4)",
    },
  ];
  const recognized = new Set(groups.flatMap((group) => group.statuses));
  return [
    ...groups.map((group) => ({
      ...group,
      count: pipelines.filter((row) => group.statuses.includes(row.status))
        .length,
    })),
    {
      name: "Other / unknown",
      color: "var(--neutral)",
      count: pipelines.filter((row) => !recognized.has(row.status)).length,
    },
  ];
}
