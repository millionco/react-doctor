import type { InspectOptions, ReactDoctorConfig } from "@react-doctor/core";
import type { InspectFlags } from "./inspect-flags.js";
import { isCiEnvironment } from "./is-ci-environment.js";
import { pickBlockingLevel } from "./resolve-blocking-level.js";
import { resolveCliCategories } from "./resolve-cli-categories.js";
import { resolveMaxDurationFlag } from "./resolve-max-duration-flag.js";
import { resolveParallelFlag } from "./resolve-parallel-flag.js";

export interface CliInspectOptions extends InspectOptions {
  categoryFilters?: string[];
}

/**
 * Translates CLI flags into the `InspectOptions` contract `inspect()`
 * accepts. Flag-derived fields only (`scoreOnly`, `noScore`, `silent`,
 * `isCi`): every `userConfig` fallback — including `noScore` — lives in
 * `inspect()`'s merge layer, which sees each project's module-merged
 * config. The plain boolean knobs (`lint`, `deadCode`, `verbose`) pass
 * through unchanged for the same reason. This resolver reads
 * `userConfig` only to decide the `--blocking warning` gate.
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
    outputDirectory: flags.outputDir,
    // `--no-respect-inline-disables` is negatable-only, so commander defaults
    // this to `true`; map that back to `undefined` so a config value can win,
    // and only honor an explicit `false` (the user passed the flag).
    respectInlineDisables: flags.respectInlineDisables === false ? false : undefined,
    warnings: wantsWarningGate ? true : flags.warnings,
    scoreOnly: flags.score === true,
    // Flag-only: an explicit opt-out wins; otherwise leave it undefined so
    // `inspect()`'s merge layer inherits `userConfig.noScore` from the
    // per-project (module-merged) config — eagerly collapsing it here from the
    // ROOT config silently overrode a workspace module's own `noScore: true`.
    noScore: flags.score === false || flags.telemetry === false ? true : undefined,
    isCi: isCiEnvironment(),
    silent: Boolean(flags.json),
    concurrency: resolveParallelFlag(flags.parallel),
    maxDurationMs: resolveMaxDurationFlag(flags.maxDuration),
    categoryFilters: resolveCliCategories(flags.category),
  };
};
