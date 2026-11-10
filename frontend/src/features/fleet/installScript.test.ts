import { describe, expect, it } from "vitest";
import {
  bootstrapSourceUrl,
  bootstrapUrl,
  installCommand,
  sourceRef,
} from "./installScript";

const origin = "https://opsdeck.example.com";

describe("agent install command", () => {
  it("pins the downloaded script and the checkout to the server commit", () => {
    expect(installCommand({ method: "docker", origin, version: "af9fb56" }))
      .toBe(`curl -fsSL https://raw.githubusercontent.com/MostafaHakam98/opsdeck/af9fb56/deploy/bootstrap-agent.sh \\
  | bash -s -- --server https://opsdeck.example.com --method docker --ref af9fb56`);
    expect(bootstrapSourceUrl("af9fb56")).toBe(
      "https://github.com/MostafaHakam98/opsdeck/blob/af9fb56/deploy/bootstrap-agent.sh",
    );
  });

  it("falls back to devel when the server reports no commit", () => {
    for (const version of [
      undefined,
      "",
      "dev",
      "AF9FB56",
      "1.2.3",
      "x; rm -rf ~",
    ]) {
      expect(sourceRef(version)).toBe("devel");
      expect(bootstrapUrl(version)).toContain("/opsdeck/devel/deploy/");
    }
    expect(
      installCommand({ method: "native", origin, version: "dev" }),
    ).toMatch(/--method native --ref origin\/devel$/);
  });

  it("carries no credential and refuses an origin that could inject shell text", () => {
    const command = installCommand({
      method: "docker",
      origin,
      version: "af9fb56",
    });
    expect(command).not.toMatch(/token|credential/i);
    expect(
      installCommand({ method: "docker", origin: "http://127.0.0.1:8080" }),
    ).toContain("--server http://127.0.0.1:8080 ");
    for (const bad of [
      "https://x.example.com; rm -rf ~",
      "https://x.example.com/path",
      "javascript:x",
    ]) {
      expect(() => installCommand({ method: "docker", origin: bad })).toThrow();
    }
  });
});
