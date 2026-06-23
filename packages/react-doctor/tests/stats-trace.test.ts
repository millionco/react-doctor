import { describe, expect, it } from "vite-plus/test";
import {
  buildStatsRowAttributes,
  recordStatsLeaderboard,
} from "../src/cli/utils/with-sentry-stats-span.js";
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
});

describe("recordStatsLeaderboard", () => {
  it("is a no-op when the run is not traced (no root span)", () => {
    expect(recordStatsLeaderboard([group({})], undefined)).toBeUndefined();
  });
});
