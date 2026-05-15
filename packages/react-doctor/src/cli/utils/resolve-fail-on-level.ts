import { logger } from "@react-doctor/core";
import type { FailOnLevel, ReactDoctorConfig } from "@react-doctor/types";
import type { InspectFlags } from "./inspect-flags.js";

const VALID_FAIL_ON_LEVELS = new Set<FailOnLevel>(["error", "warning", "none"]);
const DEFAULT_FAIL_ON_LEVEL: FailOnLevel = "error";

const isValidFailOnLevel = (level: string): level is FailOnLevel =>
  VALID_FAIL_ON_LEVELS.has(level as FailOnLevel);

export const resolveFailOnLevel = (
  flags: InspectFlags,
  userConfig: ReactDoctorConfig | null,
): FailOnLevel => {
  const sourceValue = flags.failOn ?? userConfig?.failOn ?? DEFAULT_FAIL_ON_LEVEL;
  if (isValidFailOnLevel(sourceValue)) return sourceValue;
  logger.warn(
    `Invalid failOn level "${sourceValue}". Expected one of: error, warning, none. Falling back to "none".`,
  );
  return "none";
};
