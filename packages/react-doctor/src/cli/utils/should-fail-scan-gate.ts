import { isNativeOxlintRequired, type BlockingLevel } from "@react-doctor/core";
import { filterScansForSurface, type SurfaceFilterableScan } from "./filter-scans-for-surface.js";
import { hasLintHardFailure } from "./has-lint-hard-failure.js";
import { shouldBlockCi } from "./should-block-ci.js";

export interface ShouldFailScanGateInput {
  readonly scans: ReadonlyArray<SurfaceFilterableScan>;
  readonly blockingLevel: BlockingLevel;
  readonly diagnosticsAreGateExempt?: boolean;
}

export const shouldFailScanGate = (input: ShouldFailScanGateInput): boolean => {
  const hasRequiredNativeFailure =
    isNativeOxlintRequired() &&
    input.scans.some(({ result }) =>
      result.skippedChecks.some(
        (skippedCheck) =>
          skippedCheck === "lint" ||
          skippedCheck === "dead-code" ||
          skippedCheck === "security-scan",
      ),
    );
  if (hasRequiredNativeFailure) return true;
  if (input.blockingLevel === "none") return false;
  if (input.scans.some(({ result }) => hasLintHardFailure(result))) return true;
  if (input.diagnosticsAreGateExempt === true) return false;
  return shouldBlockCi(filterScansForSurface(input.scans, "ciFailure"), input.blockingLevel);
};
