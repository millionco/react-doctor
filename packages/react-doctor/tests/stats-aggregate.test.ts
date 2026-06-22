import { describe, expect, it } from "vite-plus/test";
import type { Diagnostic } from "@react-doctor/core";
import { aggregateStats, type ScoreComputer } from "../src/stats/aggregate-stats.js";
import type { AgentSession, SessionScanResult, StatsProvider } from "../src/stats/types.js";

const diagnostic = (rule: string, severity: "error" | "warning" = "warning"): Diagnostic => ({
  filePath: "src/App.tsx",
  plugin: "react-doctor",
  rule,
  severity,
  message: "m",
  help: "h",
  line: 1,
  column: 1,
  category: "Correctness",
});

const result = (
  provider: StatsProvider,
  model: string,
  filesScanned: number,
  diagnostics: Diagnostic[],
): SessionScanResult => {
  const session: AgentSession = {
    provider,
    sessionId: `${provider}-${model}`,
    transcriptPath: "/tmp/x.jsonl",
    model,
    cwd: "/repo",
    edits: [],
    reads: [],
  };
  return {
    session,
    diagnostics,
    filesScanned,
    reconstructedFiles: filesScanned,
    unreconstructable: 0,
  };
};

// Deterministic, offline score: cleaner code (fewer diagnostics) scores higher.
const stubScore: ScoreComputer = async (diagnostics) => ({
  score: Math.max(0, 100 - diagnostics.length * 5),
  label: "stub",
});

describe("aggregateStats", () => {
  it("ranks models best-first by score and surfaces best/worst", async () => {
    const results = [
      result("claude", "m1", 4, [diagnostic("r1"), diagnostic("r1")]),
      result(
        "codex",
        "m2",
        4,
        Array.from({ length: 6 }, () => diagnostic("r2")),
      ),
    ];
    const aggregated = await aggregateStats(results, null, stubScore);

    expect(aggregated.models.map((group) => group.key)).toEqual(["claude/m1", "codex/m2"]);
    expect(aggregated.best?.key).toBe("claude/m1");
    expect(aggregated.best?.score).toBe(90);
    expect(aggregated.worst?.key).toBe("codex/m2");
    expect(aggregated.worst?.score).toBe(70);
  });

  it("computes diagnostics-per-file and top rules per group", async () => {
    const results = [result("claude", "m1", 4, [diagnostic("r1"), diagnostic("r1")])];
    const aggregated = await aggregateStats(results, null, stubScore);
    const group = aggregated.models[0];
    expect(group.totalDiagnostics).toBe(2);
    expect(group.diagnosticsPerFile).toBe(0.5);
    expect(group.topRules).toEqual([{ rule: "react-doctor/r1", count: 2 }]);
  });

  it("groups by provider and excludes under-sampled groups from the ranking", async () => {
    const results = [
      result("claude", "m1", 4, [diagnostic("r1")]),
      result("cursor", "unknown", 1, [diagnostic("r2")]),
    ];
    const aggregated = await aggregateStats(results, null, stubScore);
    // Cursor's single-file group is below the min-files threshold.
    expect(aggregated.models.map((group) => group.key)).toEqual(["claude/m1"]);
    expect(aggregated.providers.map((group) => group.provider)).toEqual(["claude"]);
  });

  it("weights the score by files and sessions so a tiny perfect sample can't top the board", async () => {
    const results = [
      result("claude", "big", 10, [diagnostic("r1")]),
      result("claude", "big", 10, []),
      result("claude", "big", 10, []),
      result("claude", "big", 10, []),
      result("claude", "big", 10, []),
      ...Array.from({ length: 5 }, () =>
        result("codex", "med", 10, [diagnostic("r2"), diagnostic("r2")]),
      ),
      result("cursor", "small", 3, []),
    ];
    const aggregated = await aggregateStats(results, null, stubScore);

    // "small" has the best RAW score (100, zero diagnostics) but only 3 files
    // from one session, so confidence weighting regresses it toward the mean and
    // the well-sampled "big" group wins instead of the tiny perfect sample.
    expect(aggregated.best?.key).toBe("claude/big");
    expect(aggregated.models[0]?.key).toBe("claude/big");
    const small = aggregated.models.find((group) => group.key === "cursor/small");
    expect(small?.score).toBe(100);
    expect(small?.weightedScore).toBeLessThan(100);
    expect(aggregated.models[0]?.weightedScore ?? 0).toBeGreaterThan(small?.weightedScore ?? 0);
  });

  it("leaves the score null when a group lacks enough files to rank fairly", async () => {
    const results = [result("claude", "m1", 1, [diagnostic("r1")])];
    let called = false;
    const aggregated = await aggregateStats(results, null, async () => {
      called = true;
      return { score: 0, label: "x" };
    });
    expect(called).toBe(false);
    expect(aggregated.models).toEqual([]);
  });
});
