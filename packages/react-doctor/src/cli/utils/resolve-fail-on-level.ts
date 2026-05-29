import type { FailOnLevel, ReactDoctorConfig } from "@react-doctor/core";
import { cliLogger as logger } from "./cli-logger.js";
import type { InspectFlags } from "./inspect-flags.js";

const VALID_FAIL_ON_LEVELS = new Set<FailOnLevel>(["error", "warning", "none"]);
// react-doctor is advisory by default: a bare run reports diagnostics +
// a score but does not fail the process. Opt in to a CI gate with
// `--fail-on error|warning` (or `failOn` in config; the GitHub Action
// passes its own `fail-on` input). The GitHub Action default is separate.
const DEFAULT_FAIL_ON_LEVEL: FailOnLevel = "none";

const isValidFailOnLevel = (level: string): level is FailOnLevel =>
  VALID_FAIL_ON_LEVELS.has(level as FailOnLevel);

export const resolveFailOnLevel = (
  flags: InspectFlags,
  userConfig: ReactDoctorConfig | null,
): FailOnLevel => {
  const sourceValue = flags.failOn ?? userConfig?.failOn ?? DEFAULT_FAIL_ON_LEVEL;
  if (isValidFailOnLevel(sourceValue)) return sourceValue;
  // An invalid threshold resolves to the default (advisory "none") and
  // warns, rather than guessing a stricter level the user didn't ask for.
  logger.warn(
    `Invalid failOn level "${sourceValue}". Expected one of: error, warning, none. Falling back to "${DEFAULT_FAIL_ON_LEVEL}".`,
  );
  return DEFAULT_FAIL_ON_LEVEL;
};
