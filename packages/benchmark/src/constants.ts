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

// Specific React Doctor rules whose intent is finer than their category
// bucket. React Doctor files bundle- and waterfall-rules under the broad
// "Performance" category; routing those exact rule ids into the dedicated
// `bundle` / `async-waterfall` dimensions lets SlopBench report them
// separately without us re-implementing detection (we DEFER to React Doctor —
// see `rule-overlap.md`). Checked before the category mapping.
export const REACT_DOCTOR_RULE_TO_DIMENSION: Record<string, SlopDimension> = {
  "react-doctor/no-barrel-import": "bundle",
  "react-doctor/no-full-lodash-import": "bundle",
  "react-doctor/no-moment": "bundle",
  "react-doctor/no-undeferred-third-party": "bundle",
  "react-doctor/prefer-dynamic-import": "bundle",
  "react-doctor/no-dynamic-import-path": "bundle",
  "react-doctor/use-lazy-motion": "bundle",
  "react-doctor/server-sequential-independent-await": "async-waterfall",
  "react-doctor/tanstack-start-loader-parallel-fetch": "async-waterfall",
};

// Threshold for the boolean-prop-soup composition check: a props type with at
// least this many boolean members is flagged (Vercel architecture-avoid-
// boolean-props). Below it, a couple of flags is normal and not slop.
export const BOOLEAN_PROP_SOUP_THRESHOLD = 4;

// Conditional-expression nesting depth at or above which the deslop nested-
// ternary heuristic fires (the deslop skill calls out nested ternaries).
export const NESTED_TERNARY_DEPTH_THRESHOLD = 2;

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
    // TypeScript slop tiers — escape hatches that silence the compiler hurt most.
    "ts/ban-ts-comment": 2.5,
    "ts/no-explicit-any": 2,
    "ts/no-non-null-assertion": 1.5,
    "ts/no-type-assertion": 1.5,
    // Composition gap-fillers (React Doctor does not count these).
    "vercel/architecture-boolean-prop-soup": 1.8,
    "vercel/patterns-render-prop": 1.3,
    // deslop maintainability heuristic.
    "deslop/nested-ternary": 1.2,
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
