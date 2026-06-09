import type { ScannerName, SlopDimension } from "./slop-dimension.js";

// A single penalized finding. Every scanner normalizes its native output into
// this shape so the scorer can treat all slop uniformly.
export interface SlopViolation {
  scanner: ScannerName;
  dimension: SlopDimension;
  // Fully-qualified rule id, e.g. `react-doctor/no-nested-component-definition`
  // or `ts/no-explicit-any`. Namespaced by scanner to stay collision-free.
  ruleId: string;
  severity: "error" | "warning";
  // The penalty this violation contributes before size-normalization.
  weight: number;
  // Repo-relative path. Empty string for project-wide findings (e.g. tsc
  // config errors) that carry no single source location.
  filePath: string;
  line: number;
  message: string;
}
