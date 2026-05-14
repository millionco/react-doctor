import type { Command } from "commander";
import { logger } from "../core/logger.js";
import type { FailOnLevel, ReactDoctorConfig } from "../types/config.js";
import type { CliFlags } from "./cli-flags.js";

const VALID_FAIL_ON_LEVELS = new Set<FailOnLevel>(["error", "warning", "none"]);

const isValidFailOnLevel = (level: string): level is FailOnLevel =>
  VALID_FAIL_ON_LEVELS.has(level as FailOnLevel);

export const resolveFailOnLevel = (
  programInstance: Command,
  flags: CliFlags,
  userConfig: ReactDoctorConfig | null,
): FailOnLevel => {
  const isCliOverride = programInstance.getOptionValueSource("failOn") === "cli";
  const sourceValue = isCliOverride ? flags.failOn : (userConfig?.failOn ?? flags.failOn);

  if (isValidFailOnLevel(sourceValue)) return sourceValue;
  logger.warn(
    `Invalid failOn level "${sourceValue}". Expected one of: error, warning, none. Falling back to "none".`,
  );
  return "none";
};
