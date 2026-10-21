import { describe, expect, it } from "vitest";
import { bytes, duration, pct, safeUrl } from "./api";
describe("operator-facing metric formatting", () => {
  it("distinguishes unavailable measurements from zero", () => {
    expect(bytes(null)).toBe("n/a");
    expect(bytes(0)).toBe("0 B");
    expect(pct(null)).toBe("n/a");
    expect(pct(0)).toBe("0.0%");
  });
  it("formats capacities and durations consistently", () => {
    expect(bytes(1024 ** 3)).toBe("1.0 GiB");
    expect(duration(125)).toBe("2m 5s");
    expect(duration(4344)).toBe("1h 12m 24s");
    expect(duration(119.9)).toBe("2m 0s");
    expect(duration(90000)).toBe("1d 1h");
  });
  it("rejects script links from integration metadata", () => {
    expect(safeUrl("javascript:alert(1)")).toBeUndefined();
    expect(safeUrl("https://gitlab.example/project")).toBe(
      "https://gitlab.example/project",
    );
  });
});
