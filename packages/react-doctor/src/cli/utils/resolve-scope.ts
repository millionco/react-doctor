import { filterSourceFiles } from "@react-doctor/core";
import type { DiffInfo, ReactDoctorConfig, ScopeValue } from "@react-doctor/core";
import { cliLogger as logger } from "./cli-logger.js";
import type { InspectFlags } from "./inspect-flags.js";
import { prompts } from "./prompts.js";

const SCOPE_VALUES = new Set<ScopeValue>(["full", "files", "changed", "lines"]);

export const isScopeValue = (value: string): value is ScopeValue =>
  SCOPE_VALUES.has(value as ScopeValue);

export interface RequestedScope {
  /** Explicit scope from `--scope` / `config.scope` / the `--diff` alias; `undefined` when unset. */
  readonly scope: ScopeValue | undefined;
  /** Explicit base ref (`--base`, `--diff <base>`, or `config.base`). */
  readonly base: string | undefined;
  /** True when the deprecated `--diff` / `diff` config supplied the scope (drives the warning). */
  readonly usedDeprecatedDiff: boolean;
}

// Coerce the deprecated `diff` (boolean | string) into a scope. `false`/`"false"`
// → full; `true`/`"true"` → changed; any other non-empty string → changed against
// that base. `undefined` / `""` contribute nothing so the next source can win.
const coerceDeprecatedDiff = (
  value: boolean | string | undefined,
): { scope: ScopeValue; base?: string } | undefined => {
  if (value === undefined) return undefined;
  if (value === false || value === "false") return { scope: "full" };
  if (value === true || value === "true") return { scope: "changed" };
  if (value === "") return undefined;
  return { scope: "changed", base: value };
};

/**
 * Resolves the *requested* scope from flags + config without touching git.
 * Precedence mirrors `pickBlockingLevel`: flags win over config, and the new
 * `--scope` wins over the deprecated `--diff` alias on each side
 * (`flags.scope` > `flags.diff` > `config.scope` > `config.diff`). Returns
 * `scope: undefined` when nothing is set so the caller can default to `full`
 * or offer the interactive prompt.
 */
export const resolveScope = (
  flags: InspectFlags,
  userConfig: ReactDoctorConfig | null,
): RequestedScope => {
  const base = flags.base ?? userConfig?.base;

  if (typeof flags.scope === "string" && flags.scope.length > 0) {
    if (isScopeValue(flags.scope)) {
      return { scope: flags.scope, base, usedDeprecatedDiff: false };
    }
    logger.warn(
      `Invalid --scope "${flags.scope}". Expected one of: full, files, changed, lines. Ignoring.`,
    );
  }

  const flagDiff = coerceDeprecatedDiff(flags.diff);
  if (flagDiff !== undefined) {
    return { scope: flagDiff.scope, base: base ?? flagDiff.base, usedDeprecatedDiff: true };
  }

  if (userConfig?.scope !== undefined) {
    if (isScopeValue(userConfig.scope)) {
      return { scope: userConfig.scope, base, usedDeprecatedDiff: false };
    }
    logger.warn(
      `Invalid scope "${userConfig.scope}" in config. Expected one of: full, files, changed, lines. Ignoring.`,
    );
  }

  const configDiff = coerceDeprecatedDiff(userConfig?.diff);
  if (configDiff !== undefined) {
    return { scope: configDiff.scope, base: base ?? configDiff.base, usedDeprecatedDiff: true };
  }

  return { scope: undefined, base, usedDeprecatedDiff: false };
};

// One-time deprecation nudge for `--diff` / `diff`, routed through cliLogger so
// it's silenced in JSON / score mode like every other CLI warning.
export const warnDeprecatedDiff = (
  flags: InspectFlags,
  userConfig: ReactDoctorConfig | null,
): void => {
  const usedFlag = flags.diff !== undefined;
  if (!usedFlag && userConfig?.diff === undefined) return;
  // Point at the scope the value actually resolves to: `--diff false` forces a
  // full scan, so suggesting `--scope changed` there would be wrong.
  const targetScope =
    coerceDeprecatedDiff(usedFlag ? flags.diff : userConfig?.diff)?.scope ?? "changed";
  if (usedFlag) {
    const baseHint = targetScope === "changed" ? " (add `--base <ref>` to pin the base)" : "";
    logger.warn(
      `The \`--diff\` flag is deprecated; use \`--scope ${targetScope}\`${baseHint} instead.`,
    );
    return;
  }
  logger.warn(`The \`diff\` config option is deprecated; use \`scope: "${targetScope}"\` instead.`);
};

const warnDiffUnavailable = (requested: RequestedScope, isQuiet: boolean): void => {
  if (isQuiet) return;
  if (typeof requested.base === "string") {
    logger.warn(
      `Could not compute diff against "${requested.base}" (git unavailable, ref not found, or merge-base failed). Running full scan.`,
    );
  } else {
    logger.warn("No feature branch or uncommitted changes detected. Running full scan.");
  }
  logger.break();
};

interface FinalizeScopeInput {
  readonly requested: RequestedScope;
  readonly diffInfo: DiffInfo | null;
  readonly skipPrompts: boolean;
  readonly isQuiet: boolean;
}

/**
 * Resolves the requested scope against the detected diff into the final scope.
 * An explicit non-`full` scope needs a usable `diffInfo`; without one it warns
 * and falls back to `full`. When nothing was requested, an interactive run on a
 * branch with changed source files is offered the "full vs changed" prompt.
 */
export const finalizeScope = async ({
  requested,
  diffInfo,
  skipPrompts,
  isQuiet,
}: FinalizeScopeInput): Promise<ScopeValue> => {
  if (requested.scope !== undefined) {
    if (requested.scope === "full") return "full";
    if (diffInfo !== null) return requested.scope;
    warnDiffUnavailable(requested, isQuiet);
    return "full";
  }

  if (diffInfo === null || skipPrompts || isQuiet) return "full";
  const changedSourceFiles = filterSourceFiles([...diffInfo.changedFiles]);
  if (changedSourceFiles.length === 0) return "full";

  const changedFilesTitle = diffInfo.isCurrentChanges
    ? `Uncommitted changes (${changedSourceFiles.length})`
    : `Changed files on ${diffInfo.currentBranch ?? "this branch"} (${changedSourceFiles.length})`;
  const changedFilesDescription = diffInfo.isCurrentChanges
    ? "Compare working tree changes against HEAD"
    : `Compare against ${diffInfo.baseBranch} from the branch merge-base`;

  const { scanScope } = await prompts({
    type: "select",
    name: "scanScope",
    message: "Choose what to scan",
    choices: [
      { title: "Full codebase", description: "Scan every source file", value: "full" },
      { title: changedFilesTitle, description: changedFilesDescription, value: "changed" },
    ],
    initial: diffInfo.isCurrentChanges ? 0 : 1,
  });
  return scanScope === "changed" ? "changed" : "full";
};
