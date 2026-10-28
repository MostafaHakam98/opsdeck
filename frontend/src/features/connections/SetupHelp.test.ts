import { describe, expect, it } from "vitest";
import { setupGuides } from "./SetupHelp";

const sources = [
  "host",
  "docker",
  "gpu",
  "runner",
  "gitlab",
  "services",
  "findings",
];

describe("connection setup help", () => {
  it("covers every collector source", () => {
    for (const source of sources) {
      expect(setupGuides[source]?.steps.length).toBeGreaterThan(0);
    }
  });

  it("keeps commands host-neutral and free of secrets", () => {
    for (const guide of Object.values(setupGuides)) {
      for (const step of guide.steps) {
        if (!step.command) continue;
        expect(step.command).not.toMatch(/\/home\/|glpat-|_TOKEN\s*=/);
      }
    }
  });
});
