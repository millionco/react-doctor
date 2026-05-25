import { resolveScanOptions } from "@react-doctor/core";
import type { InspectOptions, ReactDoctorConfig, ResolvedScanOptions } from "@react-doctor/core";
import type { InspectFlags } from "./inspect-flags.js";
import { isCiEnvironment } from "./is-ci-environment.js";

export const buildCliInspectOptionOverrides = (flags: InspectFlags): InspectOptions => ({
  lint: flags.lint,
  deadCode: flags.deadCode,
  verbose: flags.verbose,
  scoreOnly: flags.score === true,
  noScore: flags.score === false ? true : undefined,
  isCi: isCiEnvironment(),
  silent: Boolean(flags.json),
  respectInlineDisables: flags.respectInlineDisables,
  outputSurface: flags.prComment ? "prComment" : "cli",
});

export const resolveCliInspectOptions = (
  flags: InspectFlags,
  userConfig: ReactDoctorConfig | null,
): ResolvedScanOptions => resolveScanOptions(buildCliInspectOptionOverrides(flags), userConfig);
