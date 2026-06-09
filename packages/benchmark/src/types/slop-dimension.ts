// The eight slop dimensions SlopBench reports on. Each violation maps to
// exactly one dimension so penalties never double-count across scanners.
// Four are owned by React Doctor (mapped from its five user-facing
// categories), the rest by SlopBench's own scanners — see `rule-overlap.md`.
export type SlopDimension =
  | "react-correctness"
  | "react-performance"
  | "accessibility"
  | "maintainability"
  | "ts-strictness"
  | "composition"
  | "async-waterfall"
  | "bundle";

// The scanner that produced a violation. Used for provenance in the report
// and to let reviewers trace a penalty back to its source tool.
export type ScannerName = "react-doctor" | "typescript" | "vercel-checks" | "deslop-heuristics";
