import type { InspectOptions, ReactDoctorConfig } from "@react-doctor/core";
import type { InspectFlags } from "./inspect-flags.js";
import { isCiEnvironment } from "./is-ci-environment.js";
import { pickBlockingLevel } from "./resolve-blocking-level.js";
import { resolveCliCategories } from "./resolve-cli-categories.js";
import { resolveParallelFlag } from "./resolve-parallel-flag.js";

export interface CliInspectOptions extends InspectOptions {
  categoryFilters?: string[];
}

/**
 * Translates CLI flags into the `InspectOptions` contract `inspect()`
 * accepts. Flag-specific computed fields (`scoreOnly`, `noScore`,
 * `silent`, `isCi`) live here — there's no `userConfig` knob for them,
 * only flag derivation. The plain boolean knobs (`lint`, `deadCode`,
 * `verbose`) pass through unchanged: `inspect()` owns the
 * userConfig-fallback layer so the merge logic isn't duplicated. The
 * shell still hands `userConfig` in via `configOverride` and `noScore`
 * so this resolver can apply the one flag-and-config rule that flags own
 * (`--score false` wins, otherwise inherit `userConfig.noScore`).
 */
export const resolveCliInspectOptions = (
  flags: InspectFlags,
  userConfig: ReactDoctorConfig | null,
): CliInspectOptions => {
  // A `warning`-level CI gate is meaningless unless warnings reach the
  // ciFailure surface, so the gate wins: when `--blocking warning` is set it
  // forces warnings on even over an explicit `--no-warnings` (you can't block
  // on warnings you've hidden). Otherwise the warnings flag passes through.
  // The gate level itself is resolved by `resolveBlockingLevel`.
  const wantsWarningGate = pickBlockingLevel(flags, userConfig) === "warning";

  return {
    lint: flags.lint,
    deadCode: flags.deadCode,
    verbose: flags.verbose,
    // `--no-respect-inline-disables` is negatable-only, so commander defaults
    // this to `true`; map that back to `undefined` so a config value can win,
    // and only honor an explicit `false` (the user passed the flag).
    respectInlineDisables: flags.respectInlineDisables === false ? false : undefined,
    warnings: wantsWarningGate ? true : flags.warnings,
    scoreOnly: flags.score === true,
    noScore: flags.score === false || flags.telemetry === false || (userConfig?.noScore ?? false),
    isCi: isCiEnvironment(),
    silent: Boolean(flags.json),
    concurrency: resolveParallelFlag(flags.parallel),
    categoryFilters: resolveCliCategories(flags.category),
  };
};
