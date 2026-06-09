import type { SlopDimension } from "./slop-dimension.js";
import type { SlopViolation } from "./slop-violation.js";

// Per-dimension rollup. `score` is 0–100 (higher = cleaner); `weightedPenalty`
// is the size-normalized penalty that drove it down from 100.
export interface SlopDimensionScore {
  dimension: SlopDimension;
  score: number;
  violationCount: number;
  weightedPenalty: number;
}

// Size of the graded diff, used to normalize penalties. Tests and generated
// files are excluded upstream so they neither earn nor dodge penalties.
export interface SlopDiffStats {
  changedFileCount: number;
  addedLineCount: number;
  // The effective divisor the scorer used (after clamping to the profile's
  // min), recorded for auditability.
  normalizerLines: number;
}

// The machine-readable grading artifact every task emits. Consumed by the
// runner aggregation script and (v2) the leaderboard.
export interface SlopReport {
  scoringVersion: string;
  // React Doctor CLI version that produced the diagnostics, when detectable.
  doctorVersion: string | null;
  generatedAt: string;
  diffStats: SlopDiffStats;
  violations: SlopViolation[];
  dimensions: SlopDimensionScore[];
  // Composite 0–100 cleanliness score (higher = less slop).
  slopScore: number;
  // Filled by the task's `test.sh` once the functional gate is known; `null`
  // when the verifier runs standalone (quality-only).
  functionalPass: boolean | null;
  // `functionalPass ? slopScore / 100 : 0`, or `null` when the gate is unknown.
  reward: number | null;
}
