import { describe, expect, it } from "vite-plus/test";
import { renderStatsReport } from "../src/stats/render-stats.js";
import type { GroupStats, StatsReport } from "../src/stats/types.js";

const group = (overrides: Partial<GroupStats>): GroupStats => ({
  key: "claude/m1",
  provider: "claude",
  sessions: 1,
  filesScanned: 4,
  unreconstructable: 0,
  totalDiagnostics: 2,
  errorCount: 0,
  warningCount: 2,
  diagnosticsPerFile: 0.5,
  score: 90,
  scoreLabel: "good",
  weightedScore: 88,
  topRules: [],
  ...overrides,
});

const report = (overrides: Partial<StatsReport>): StatsReport => ({
  scope: "repo",
  directory: "/repo",
  models: [],
  providers: [],
  best: null,
  worst: null,
  sessionsAnalyzed: 0,
  sessionsRanked: 0,
  sessionsNonReact: 0,
  sessionsUnreconstructable: 0,
  generatedAt: "2026-06-20T00:00:00.000Z",
  ...overrides,
});

describe("renderStatsReport", () => {
  it("renders a model leaderboard with the best/worst callout", () => {
    const best = group({ key: "claude/opus", score: 95 });
    const worst = group({ key: "codex/gpt", provider: "codex", score: 60, diagnosticsPerFile: 2 });
    const output = renderStatsReport(
      report({
        models: [best, worst],
        providers: [best],
        best,
        worst,
        sessionsAnalyzed: 2,
        sessionsRanked: 2,
      }),
    );
    expect(output).toContain("React Doctor leaderboard");
    expect(output).toContain("Which agent writes the cleanest React code");
    expect(output).toContain("opus");
    expect(output).toContain("gpt");
    expect(output).toContain("Best");
    expect(output).toContain("Worst");
  });

  it("shows a friendly message when there is nothing to rank", () => {
    const output = renderStatsReport(report({ sessionsAnalyzed: 3 }));
    expect(output).toContain("Nothing to rank yet");
  });

  it("notes non-React sessions separately from unreplayable ones", () => {
    const only = group({});
    const output = renderStatsReport(
      report({
        models: [only],
        providers: [only],
        best: only,
        sessionsAnalyzed: 5,
        sessionsRanked: 1,
        sessionsNonReact: 3,
        sessionsUnreconstructable: 1,
      }),
    );
    expect(output).toContain("Skipped 3 that changed only non-React files");
    expect(output).toContain("Skipped 1 that used edits we could not replay");
  });

  it("appends the community leaderboard with sample sizes when one is supplied", () => {
    const only = group({ key: "claude/opus" });
    const output = renderStatsReport(report({ models: [only], providers: [only], best: only }), {
      generatedAt: "2026-06-22T00:00:00.000Z",
      models: [{ model: "opus", harness: "claude", communityScore: 81, runs: 42, files: 900 }],
    });
    expect(output).toContain("Community leaderboard (all react-doctor users)");
    expect(output).toContain("81");
    expect(output).toContain("42");
  });

  it("omits the community section when no board is supplied (offline / --no-telemetry)", () => {
    const only = group({});
    const output = renderStatsReport(report({ models: [only], providers: [only], best: only }));
    expect(output).not.toContain("Community leaderboard");
  });
});
