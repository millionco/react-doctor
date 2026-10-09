import type { BlockingLevel } from "@react-doctor/core";
import { SCAN_FAILURE_EXIT_CODE, SCAN_SUCCESS_EXIT_CODE } from "./constants.js";
import { filterScansForSurface, type SurfaceFilterableScan } from "./filter-scans-for-surface.js";
import { hasLintHardFailure } from "./has-lint-hard-failure.js";
import { shouldBlockCi } from "./should-block-ci.js";

export interface ResolveScanExitCodeInput {
  readonly scans: ReadonlyArray<SurfaceFilterableScan>;
  readonly blockingLevel: BlockingLevel;
  readonly diagnosticsAreGateExempt?: boolean;
  readonly warningExitCode?: number;
}

export const resolveScanExitCode = (input: ResolveScanExitCodeInput): number => {
  if (input.blockingLevel === "none") return SCAN_SUCCESS_EXIT_CODE;
  if (input.scans.some(({ result }) => hasLintHardFailure(result))) return SCAN_FAILURE_EXIT_CODE;
  if (input.diagnosticsAreGateExempt === true) return SCAN_SUCCESS_EXIT_CODE;
  const diagnostics = filterScansForSurface(input.scans, "ciFailure");
  if (shouldBlockCi(diagnostics, input.blockingLevel)) return SCAN_FAILURE_EXIT_CODE;
  if (diagnostics.some((diagnostic) => diagnostic.severity === "warning")) {
    return input.warningExitCode ?? SCAN_SUCCESS_EXIT_CODE;
  }
  return SCAN_SUCCESS_EXIT_CODE;
};
