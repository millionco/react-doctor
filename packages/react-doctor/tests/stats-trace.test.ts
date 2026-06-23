import { describe, expect, it } from "vite-plus/test";
import {
  buildStatsRowAttributes,
  recordStatsLeaderboard,
} from "../src/cli/utils/with-sentry-stats-span.js";
import { toLeaderboardRow } from "../src/stats/leaderboard-row.js";
import type { GroupStats } from "../src/stats/types.js";

const group = (overrides: Partial<GroupStats>): GroupStats => ({
  key: "claude/claude-sonnet-4-5",
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

describe("buildStatsRowAttributes", () => {
  it("projects the four leaderboard columns, stripping the provider prefix from the model", () => {
    expect(buildStatsRowAttributes(group({}))).toEqual({
      "stats.model": "claude-sonnet-4-5",
      "stats.harness": "claude",
      "stats.score": 88,
      "stats.files": 4,
    });
  });

  it("ranks on the confidence-weighted score, not the raw score", () => {
    expect(buildStatsRowAttributes(group({ score: 90, weightedScore: 72 }))["stats.score"]).toBe(
      72,
    );
  });

  it("drops an undersampled (null) score rather than coercing it to a string", () => {
    expect(buildStatsRowAttributes(group({ weightedScore: null }))).not.toHaveProperty(
      "stats.score",
    );
  });

  it("passes a provider-only key (no slash) through as the model name", () => {
    expect(buildStatsRowAttributes(group({ key: "codex", provider: "codex" }))["stats.model"]).toBe(
      "codex",
    );
  });

  it("emits only the four leaderboard attribute keys — never code, paths, or identity", () => {
    expect(Object.keys(buildStatsRowAttributes(group({}))).sort()).toEqual([
      "stats.files",
      "stats.harness",
      "stats.model",
      "stats.score",
    ]);
  });

  it("derives the span attributes from the same projection the /api/stats payload uses (no drift)", () => {
    const sample = group({
      key: "cursor/composer-2.5",
      provider: "cursor",
      weightedScore: 67,
      filesScanned: 12,
    });
    const row = toLeaderboardRow(sample);
    expect(buildStatsRowAttributes(sample)).toEqual({
      "stats.model": row.model,
      "stats.harness": row.harness,
      "stats.score": row.score,
      "stats.files": row.files,
    });
  });
});

describe("recordStatsLeaderboard", () => {
  it("is a no-op when the run is not traced (no root span)", () => {
    expect(recordStatsLeaderboard([group({})], undefined)).toBeUndefined();
  });
});
