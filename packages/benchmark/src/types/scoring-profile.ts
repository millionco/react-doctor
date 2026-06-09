import type { SlopDimension } from "./slop-dimension.js";

// A versioned, fully-declarative weight table. Every number that influences a
// score lives here (loaded from `scoring-profiles/<name>.json`) so a score is
// reproducible from its `version` alone. No weights are hard-coded in the
// scorer — `constants.ts` only carries the built-in fallback profile.
export interface ScoringProfile {
  version: string;
  // Base penalty per finding, before category/impact multipliers.
  severityWeights: {
    error: number;
    warning: number;
  };
  // React Doctor's five user-facing categories → penalty multiplier.
  // Keyed by the exact category string React Doctor emits
  // (Security, Bugs, Performance, Accessibility, Maintainability).
  categoryMultipliers: Record<string, number>;
  // Optional per-rule multiplier (e.g. derived from a Vercel rule's CRITICAL
  // / HIGH impact tier). Keyed by fully-qualified `ruleId`. Missing ⇒ 1.
  ruleImpactMultipliers: Record<string, number>;
  // How much each dimension counts toward the composite slop score. Need not
  // sum to 1 — the scorer normalizes by the total of present dimensions.
  dimensionWeights: Record<SlopDimension, number>;
  // Penalty is divided by `max(changedLines, minNormalizerLines) /
  // diffSizeNormalizerLines`, so a large legitimate feature is not punished as
  // hard as the same violation count in a tiny diff.
  diffSizeNormalizerLines: number;
  minNormalizerLines: number;
}
