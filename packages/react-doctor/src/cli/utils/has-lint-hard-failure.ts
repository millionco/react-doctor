import type { InspectResult } from "@react-doctor/core";

// `skippedChecks` carries "lint" only when the whole lint pass failed
// (`didLintFail` in core's `build-skipped-checks`): an engine, plugin, or
// native-binding failure that destroyed every finding, so a zero exit would
// report a false clean. Deliberate skips (`--no-lint`) and fail-open
// degradations (`lint:partial`, supply-chain, security-scan) don't qualify.
export const hasLintHardFailure = (result: InspectResult): boolean =>
  result.skippedChecks.includes("lint");
