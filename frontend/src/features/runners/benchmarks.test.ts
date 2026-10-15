import { describe, expect, it } from "vitest";
import {
  changeLabel,
  compareTiming,
  timingRows,
  reportMarkdown,
} from "./benchmarks";

describe("evidence-based timing comparisons", () => {
  it("calculates speedup, saved time and regression direction", () => {
    expect(compareTiming(120, 30)).toEqual({
      factor: 4,
      savedSeconds: 90,
      reductionPercent: 75,
    });
    expect(changeLabel(compareTiming(30, 60))).toBe("30s longer (100.0%)");
  });
  it("keeps unknown timings distinct from zero and avoids infinite ratios", () => {
    expect(compareTiming(null, 0)).toBeNull();
    expect(compareTiming(5, undefined)).toBeNull();
    expect(compareTiming(5, NaN)).toBeNull();
    expect(compareTiming(5, 0)).toEqual({
      factor: null,
      savedSeconds: 5,
      reductionPercent: 100,
    });
    expect(compareTiming(0, 5)).toEqual({
      factor: null,
      savedSeconds: -5,
      reductionPercent: null,
    });
  });
  it("shows when queue wait offsets execution gains", () => {
    const rows = timingRows(
      {
        pipeline_id: 1,
        label: "Before",
        status: "success",
        wall_seconds: 120,
        queue_seconds: 0,
      },
      {
        pipeline_id: 2,
        label: "After",
        status: "success",
        wall_seconds: 30,
        queue_seconds: 120,
      },
    );
    expect(rows[1].comparison?.factor).toBe(4);
    expect(rows[3].comparison?.savedSeconds).toBe(-30);
    expect(
      timingRows(
        {
          pipeline_id: 1,
          label: "Before",
          status: "success",
          wall_seconds: 120,
        },
        { pipeline_id: 2, label: "After", status: "success", wall_seconds: 30 },
      )[3].comparison,
    ).toBeNull();
  });
  it("exports the selected job columns and labels projections", () => {
    const benchmarks = [
      {
        pipeline_id: 1,
        label: "Before",
        status: "success",
        runner_seconds: 120,
      },
      { pipeline_id: 2, label: "After", status: "success", runner_seconds: 30 },
    ];
    const report = reportMarkdown(
      {
        title: "Example",
        recorded_on: "2026-01-01",
        source_name: "Operator report",
        benchmarks,
        job_comparisons: [{ name: "build", seconds: [120, 30] }],
        optimizations: [],
        notes: [],
        measurements: [
          { title: "Target", kind: "projection", after: "10 seconds" },
        ],
      },
      benchmarks[0],
      benchmarks[1],
    );
    expect(report).toContain("1m 30s saved (75.0%)");
    expect(report).toContain("(projection)");
    expect(report).toContain("Execution speedup excludes queue wait");
  });
});
