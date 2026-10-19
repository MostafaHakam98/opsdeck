import { describe, expect, it } from "vitest";
import { distribution, historyDistribution, pipelineOutcomes } from "./metrics";

describe("diagnostic evidence", () => {
  it("keeps missing, invalid and negative timings out of averages and percentiles", () => {
    expect(
      distribution([null, undefined, NaN, Infinity, -3, "20", 0, 10, 20]),
    ).toEqual({ count: 3, mean: 10, peak: 20, p95: 20 });
    expect(distribution([null, NaN])).toEqual({
      count: 0,
      mean: null,
      peak: null,
      p95: null,
    });
  });

  it("uses the nearest-rank p95 without dropping genuine zero timings", () => {
    expect(
      distribution(Array.from({ length: 20 }, (_, index) => index)).p95,
    ).toBe(18);
    expect(distribution([0])).toEqual({ count: 1, mean: 0, peak: 0, p95: 0 });
  });

  it("preserves original peaks when history has been downsampled", () => {
    const history = [
      { cpu: 10, cpu_peak: 80 },
      { cpu: 20, cpu_peak: 95 },
      { cpu: null, cpu_peak: null },
    ];
    expect(historyDistribution(history, "cpu")).toMatchObject({
      count: 2,
      mean: 15,
      peak: 95,
    });
    expect(historyDistribution([{ cpu: 0 }, { cpu: 15 }], "cpu").peak).toBe(15);
    expect(historyDistribution([{ cpu: null }], "cpu").peak).toBeNull();
  });

  it("accounts for every pipeline without treating observations as successful results", () => {
    const counts = pipelineOutcomes(
      [
        "success",
        "failed",
        "pending",
        "running",
        "canceled",
        "skipped",
        "manual",
        "observed_running",
        "unknown",
      ].map((status) => ({ status })),
    );
    expect(counts.map((row) => [row.name, row.count])).toEqual([
      ["Successful", 1],
      ["Failed", 1],
      ["In progress", 2],
      ["Canceled / skipped", 2],
      ["Other / unknown", 3],
    ]);
    expect(counts.reduce((sum, row) => sum + row.count, 0)).toBe(9);
    expect(pipelineOutcomes([]).every((row) => row.count === 0)).toBe(true);
  });
});
