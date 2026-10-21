import { describe, expect, it } from "vitest";
import { fuzzyScore, matchCommand, rankCommands } from "./CommandPalette";

const command = (label: string, group = "Pages", keywords = "") => ({
  id: label,
  label,
  group,
  keywords,
  run: () => {},
});

describe("command palette matching", () => {
  it("matches in-order subsequences and rejects missing characters", () => {
    expect(fuzzyScore("flt", "Fleet audit")).not.toBeNull();
    expect(fuzzyScore("tlf", "Fleet audit")).toBeNull();
    expect(fuzzyScore("fleetx", "Fleet audit")).toBeNull();
  });

  it("ignores case and whitespace in the query", () => {
    expect(fuzzyScore("FLEET AUDIT", "fleet audit")).not.toBeNull();
    expect(matchCommand("  ", command("Overview"))).toBe(0);
  });

  it("prefers contiguous runs and word starts over scattered hits", () => {
    const tight = fuzzyScore("run", "Runner stack")!;
    const loose = fuzzyScore("run", "Overview of queued nodes")!;
    expect(tight).toBeGreaterThan(loose);
    const wordStart = fuzzyScore("ea", "Enroll agent")!;
    const midWord = fuzzyScore("ea", "Clear cache")!;
    expect(wordStart).toBeGreaterThan(midWord);
  });

  it("searches keywords and group but ranks label matches first", () => {
    const viaKeyword = command("Connections", "Pages", "gitlab token");
    expect(matchCommand("gitlab", viaKeyword)).not.toBeNull();
    expect(matchCommand("hosts", command("runner-07", "Hosts"))).not.toBeNull();
    expect(matchCommand("zzz", viaKeyword)).toBeNull();
    const label = matchCommand("gitlab", command("GitLab setup"))!;
    expect(label).toBeGreaterThan(matchCommand("gitlab", viaKeyword)!);
  });

  it("boosts label prefixes", () => {
    const prefix = matchCommand("over", command("Overview"))!;
    const inner = matchCommand("over", command("Host overview"))!;
    expect(prefix).toBeGreaterThan(inner);
  });

  it("filters, ranks and groups results by best hit", () => {
    const groups = rankCommands(
      [
        command("Overview"),
        command("runner-01", "Hosts", "ci gpu"),
        command("runner-02", "Hosts"),
        command("Runner stack"),
      ],
      "runner",
    );
    // Equal scores keep the caller's order, so Hosts (listed first) leads.
    expect(groups.map((g) => g.group)).toEqual(["Hosts", "Pages"]);
    expect(groups[0].items.map((c) => c.label)).toEqual([
      "runner-01",
      "runner-02",
    ]);
    expect(groups[1].items.map((c) => c.label)).toEqual(["Runner stack"]);
    expect(
      rankCommands([command("Overview"), command("Runner stack")], "stk").map(
        (g) => g.items.map((c) => c.label),
      ),
    ).toEqual([["Runner stack"]]);
  });

  it("keeps the original order and every command for an empty query", () => {
    const groups = rankCommands(
      [command("B", "Hosts"), command("A"), command("C", "Hosts")],
      "",
    );
    expect(groups).toEqual([
      {
        group: "Hosts",
        items: [
          expect.objectContaining({ label: "B" }),
          expect.objectContaining({ label: "C" }),
        ],
      },
      { group: "Pages", items: [expect.objectContaining({ label: "A" })] },
    ]);
  });
});
