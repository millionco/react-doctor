import type { Command } from "commander";
import type { ReactDoctorConfig } from "../types/config.js";
import type { CliFlags } from "./cli-flags.js";
import { coerceDiffValue } from "./coerce-diff-value.js";

export const resolveEffectiveDiff = (
  flags: CliFlags,
  userConfig: ReactDoctorConfig | null,
  programInstance: Command,
): boolean | string | undefined => {
  // HACK: --full is the documented "always run a full scan" escape hatch.
  // It must override config-set `diff: true` / `diff: "main"`, otherwise
  // the flag is silently ignored when a project's react-doctor.config.json
  // has any diff value.
  if (flags.full) return false;
  const isDiffCliOverride = programInstance.getOptionValueSource("diff") === "cli";
  const rawValue = isDiffCliOverride ? flags.diff : userConfig?.diff;
  return coerceDiffValue(rawValue);
};
