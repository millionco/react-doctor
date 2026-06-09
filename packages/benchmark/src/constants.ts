import type { ScoringProfile, SlopDimension } from "./types/index.js";

// Bump when the scoring formula or the built-in profile changes in a way that
// makes scores incomparable across versions. Stamped into every SlopReport.
export const SCORING_VERSION = "1.0.0";

export const SCORE_MAX = 100;
export const SCORE_MIN = 0;

// Default CLI to invoke when a task does not pin one (resolved on PATH).
export const DEFAULT_REACT_DOCTOR_BIN = "react-doctor";

// React Doctor emits five user-facing categories; each maps to exactly one
// SlopBench dimension so a React Doctor finding lands in a single bucket.
export const REACT_DOCTOR_CATEGORY_TO_DIMENSION: Record<string, SlopDimension> = {
  Security: "react-correctness",
  Bugs: "react-correctness",
  Performance: "react-performance",
  Accessibility: "accessibility",
  Maintainability: "maintainability",
};

// Where a React Doctor diagnostic falls when its category string is
// unrecognized (e.g. a newly added bucket): treated as a correctness signal.
export const REACT_DOCTOR_FALLBACK_DIMENSION: SlopDimension = "react-correctness";

// The built-in fallback profile and single source of truth for default
// weights. `scoring-profiles/default.json` mirrors this object; a drift test
// keeps them identical. Tasks may override via `slop-verify --profile <path>`.
export const DEFAULT_SCORING_PROFILE: ScoringProfile = {
  version: SCORING_VERSION,
  severityWeights: {
    error: 5,
    warning: 2,
  },
  categoryMultipliers: {
    Security: 3,
    Bugs: 2,
    Performance: 1.5,
    Accessibility: 1.2,
    Maintainability: 1,
  },
  ruleImpactMultipliers: {
    // Vercel CRITICAL-impact gap-filler checks weigh heaviest.
    "vercel/async-sequential-await": 2.5,
    "vercel/bundle-barrel-import": 2,
    "vercel/architecture-boolean-prop-soup": 1.8,
    "vercel/patterns-render-prop": 1.3,
    "vercel/react19-forward-ref": 1.2,
    // TypeScript slop tiers — escape hatches hurt most.
    "ts/ban-ts-comment": 2.5,
    "ts/no-explicit-any": 2,
    "ts/no-non-null-assertion": 1.5,
    "ts/no-unnecessary-type-assertion": 1.5,
    "tsc/type-error": 3,
  },
  dimensionWeights: {
    "react-correctness": 1.5,
    "ts-strictness": 1.5,
    "react-performance": 1.2,
    composition: 1,
    "async-waterfall": 1,
    bundle: 1,
    maintainability: 1,
    accessibility: 0.8,
  },
  diffSizeNormalizerLines: 40,
  minNormalizerLines: 25,
};

// Default multiplier for a finding whose category / rule is not in the
// profile's multiplier tables.
export const DEFAULT_WEIGHT_MULTIPLIER = 1;
