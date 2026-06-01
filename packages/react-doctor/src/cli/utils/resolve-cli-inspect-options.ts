import type { InspectOptions, ReactDoctorConfig } from "@react-doctor/core";
import type { InspectFlags } from "./inspect-flags.js";
import { isCiEnvironment } from "./is-ci-environment.js";
import { resolveParallelFlag } from "./resolve-parallel-flag.js";

/**
 * Translates CLI flags into the `InspectOptions` contract `inspect()`
 * accepts. Flag-specific computed fields (`scoreOnly`, `noScore`,
 * `silent`, `outputSurface`, `isCi`) live here — there's no
 * `userConfig` knob for them, only flag derivation. The remaining
 * boolean knobs (`lint`, `deadCode`, `verbose`, `respectInlineDisables`)
 * pass through unchanged: `inspect()` owns the userConfig-fallback
 * layer so the merge logic isn't duplicated. The shell still hands
 * `userConfig` in via `configOverride` and `noScore` so this resolver
 * can apply the one flag-and-config rule that flags own
 * (`--score false` wins, otherwise inherit `userConfig.noScore`).
 */
export const resolveCliInspectOptions = (
  flags: InspectFlags,
  userConfig: ReactDoctorConfig | null,
): InspectOptions => {
  // Warnings show by default, but `--fail-on warning` is meaningless
  // unless they reach the CI-failure surface — so a warning gate forces
  // them on even when the user hid them via `warnings: false` in config.
  // An explicit `--warnings` / `--no-warnings` still wins. Mirrors
  // `resolveFailOnLevel`'s flag→config precedence without its
  // invalid-level logging (that resolver still owns the actual gate).
  const wantsWarningGate = (flags.failOn ?? userConfig?.failOn) === "warning";

  return {
    lint: flags.lint,
    deadCode: flags.deadCode,
    verbose: flags.verbose,
    respectInlineDisables: flags.respectInlineDisables,
    warnings: flags.warnings ?? (wantsWarningGate ? true : undefined),
    scoreOnly: flags.score === true,
    noScore: flags.score === false || flags.telemetry === false || (userConfig?.noScore ?? false),
    isCi: isCiEnvironment(),
    silent: Boolean(flags.json),
    outputSurface: flags.prComment ? "prComment" : "cli",
    concurrency: resolveParallelFlag(flags.parallel),
  };
};
