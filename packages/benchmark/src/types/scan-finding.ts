import type { ScannerName, SlopDimension } from "./slop-dimension.js";

// What a scanner emits before scoring. The orchestrator converts every
// `ScanFinding` into a weighted `SlopViolation` in one place
// (`scoring/compute-violation-weight.ts`), so scanners stay weight-agnostic.
export interface ScanFinding {
  scanner: ScannerName;
  dimension: SlopDimension;
  ruleId: string;
  severity: "error" | "warning";
  filePath: string;
  line: number;
  message: string;
  // React Doctor's user-facing category, when the finding came from it. Used
  // only to pick the profile's `categoryMultipliers` entry; absent for the
  // custom scanners, which rely on `ruleImpactMultipliers` instead.
  category?: string;
}
