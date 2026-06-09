import * as path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { DEFAULT_SCORING_PROFILE } from "../src/constants.js";
import { computeSlopScore } from "../src/scoring/slop-score.js";
import { loadScoringProfile } from "../src/scoring/load-scoring-profile.js";
import type { ScanFinding } from "../src/types/index.js";

const DEFAULT_PROFILE_PATH = path.resolve(
  import.meta.dirname,
  "..",
  "scoring-profiles",
  "default.json",
);

const finding = (overrides: Partial<ScanFinding>): ScanFinding => ({
  scanner: "react-doctor",
  dimension: "react-correctness",
  ruleId: "react-doctor/no-nested-component-definition",
  severity: "error",
  filePath: "src/x.tsx",
  line: 1,
  message: "slop",
  category: "Bugs",
  ...overrides,
});

describe("computeSlopScore", () => {
  it("scores a clean diff at a perfect 100", () => {
    const result = computeSlopScore([], 60, DEFAULT_SCORING_PROFILE);
    expect(result.slopScore).toBe(100);
    expect(result.violations).toHaveLength(0);
    expect(result.dimensions.every((dimension) => dimension.score === 100)).toBe(true);
  });

  it("is deterministic across runs", () => {
    const findings = [
      finding({}),
      finding({ severity: "warning", category: "Performance", dimension: "react-performance" }),
    ];
    const first = computeSlopScore(findings, 60, DEFAULT_SCORING_PROFILE);
    const second = computeSlopScore(findings, 60, DEFAULT_SCORING_PROFILE);
    expect(first.slopScore).toBe(second.slopScore);
  });

  it("penalizes a security error more than a maintainability warning", () => {
    const security = computeSlopScore(
      [finding({ category: "Security", dimension: "react-correctness", severity: "error" })],
      60,
      DEFAULT_SCORING_PROFILE,
    );
    const maintainability = computeSlopScore(
      [finding({ category: "Maintainability", dimension: "maintainability", severity: "warning" })],
      60,
      DEFAULT_SCORING_PROFILE,
    );
    expect(security.slopScore).toBeLessThan(maintainability.slopScore);
  });

  it("punishes the same violation harder in a tiny diff than a large one", () => {
    const single = [finding({})];
    const tiny = computeSlopScore(single, 10, DEFAULT_SCORING_PROFILE);
    const large = computeSlopScore(single, 400, DEFAULT_SCORING_PROFILE);
    expect(tiny.slopScore).toBeLessThan(large.slopScore);
  });

  it("floors a very sloppy diff at zero rather than going negative", () => {
    const manyErrors = Array.from({ length: 40 }, () =>
      finding({ category: "Security", severity: "error" }),
    );
    const result = computeSlopScore(manyErrors, 30, DEFAULT_SCORING_PROFILE);
    const correctness = result.dimensions.find((d) => d.dimension === "react-correctness");
    expect(correctness?.score).toBe(0);
    expect(result.slopScore).toBeGreaterThanOrEqual(0);
  });

  it("keeps a moderately clean feature in a healthy band", () => {
    const findings = [
      finding({ severity: "warning", category: "Performance", dimension: "react-performance" }),
      finding({ severity: "warning", category: "Maintainability", dimension: "maintainability" }),
    ];
    const result = computeSlopScore(findings, 80, DEFAULT_SCORING_PROFILE);
    expect(result.slopScore).toBeGreaterThan(90);
    expect(result.slopScore).toBeLessThan(100);
  });
});

describe("loadScoringProfile", () => {
  it("returns the built-in default when no path is given", () => {
    expect(loadScoringProfile()).toBe(DEFAULT_SCORING_PROFILE);
  });

  it("default.json mirrors the built-in profile (no drift)", () => {
    const fromDisk = loadScoringProfile(DEFAULT_PROFILE_PATH);
    expect(fromDisk).toStrictEqual(DEFAULT_SCORING_PROFILE);
  });
});
