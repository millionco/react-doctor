import type { Command } from "commander";
import type { InspectOptions, ReactDoctorConfig } from "../types.js";
import type { CliFlags } from "./cli-flags.js";
import { isCiEnvironment } from "./is-ci-environment.js";

export const resolveCliInspectOptions = (
  flags: CliFlags,
  userConfig: ReactDoctorConfig | null,
  programInstance: Command,
): InspectOptions => {
  const isCliOverride = (optionName: string) =>
    programInstance.getOptionValueSource(optionName) === "cli";

  return {
    lint: isCliOverride("lint") ? flags.lint : (userConfig?.lint ?? true),
    deadCode: isCliOverride("deadCode") ? flags.deadCode : (userConfig?.deadCode ?? true),
    verbose: isCliOverride("verbose") ? flags.verbose : (userConfig?.verbose ?? false),
    scoreOnly: flags.score,
    offline: flags.offline || (userConfig?.offline ?? false) || isCiEnvironment(),
    silent: flags.json,
    respectInlineDisables: isCliOverride("respectInlineDisables")
      ? flags.respectInlineDisables
      : (userConfig?.respectInlineDisables ?? true),
  };
};
