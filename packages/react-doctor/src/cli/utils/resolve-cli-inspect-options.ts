import type { InspectOptions, ReactDoctorConfig } from "@react-doctor/core";
import type { InspectFlags } from "./inspect-flags.js";
import { isCiEnvironment } from "./is-ci-environment.js";

export const resolveCliInspectOptions = (
  flags: InspectFlags,
  userConfig: ReactDoctorConfig | null,
): InspectOptions => ({
  lint: flags.lint ?? userConfig?.lint ?? true,
  deadCode: flags.deadCode ?? userConfig?.deadCode ?? true,
  verbose: flags.verbose ?? userConfig?.verbose ?? false,
  scoreOnly: Boolean(flags.score),
  offline: Boolean(flags.offline) || (userConfig?.offline ?? false),
  isCi: isCiEnvironment(),
  silent: Boolean(flags.json),
  respectInlineDisables: flags.respectInlineDisables ?? userConfig?.respectInlineDisables ?? true,
  outputSurface: flags.prComment ? "prComment" : "cli",
});
