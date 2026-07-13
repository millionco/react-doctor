import type { ScopeValue } from "@react-doctor/core";
import { CliInputError } from "./cli-input-error.js";
import type { InspectFlags } from "./inspect-flags.js";

// "The user asked for a diff scope via the deprecated `--diff`" — `false` /
// `"false"` / `""` mean "force a full scan", so they don't count as a mode.
const usedDiffAlias = (flags: InspectFlags): boolean =>
  flags.diff !== undefined && flags.diff !== false && flags.diff !== "false" && flags.diff !== "";

const usedScope = (flags: InspectFlags): boolean =>
  typeof flags.scope === "string" && flags.scope.length > 0;

// `--include-untracked` folds untracked files into a working-tree scope, so it
// needs `files` / `changed` / `lines` in effect. This is checked against the
// RESOLVED scope (so a `config.scope` / `config.diff` value counts, not just
// the CLI flags), which is why it lives apart from `validateModeFlags`. `full`
// already walks the filesystem and sees untracked files; no scope is a no-op.
export const validateIncludeUntrackedScope = (
  includeUntracked: boolean,
  scope: ScopeValue | undefined,
): void => {
  if (!includeUntracked || (scope !== undefined && scope !== "full")) return;
  throw new CliInputError(
    "--include-untracked requires the files, changed, or lines scope (via --scope, --diff, or config).",
  );
};

export const validateModeFlags = (flags: InspectFlags): void => {
  if (usedScope(flags) && usedDiffAlias(flags)) {
    throw new CliInputError("Cannot combine --scope and --diff; --diff is the deprecated alias.");
  }
  if (flags.staged && usedDiffAlias(flags)) {
    throw new CliInputError("Cannot combine --staged and --diff; pick one mode.");
  }
  // `--staged` scans the git index; `full` / `changed` (which need a base
  // branch) don't apply. `files` (default) and `lines` compose with it.
  if (flags.staged && (flags.scope === "full" || flags.scope === "changed")) {
    throw new CliInputError(
      `Cannot combine --staged with --scope ${flags.scope}; use --scope files or --scope lines, or drop --scope.`,
    );
  }
  // The scope requirement is enforced separately (against the resolved scope)
  // by `validateIncludeUntrackedScope`; staged mode is flag-only, so reject it
  // here — the git index never holds untracked files.
  if (flags.includeUntracked && flags.staged) {
    throw new CliInputError(
      "Cannot combine --include-untracked with --staged; the git index never holds untracked files.",
    );
  }
  if (flags.score && flags.json) {
    throw new CliInputError("Cannot combine --score and --json; pick one output mode.");
  }
  if (flags.score && flags.telemetry === false) {
    throw new CliInputError(
      "Cannot combine --score with --no-telemetry; --score prints the score that --no-telemetry disables.",
    );
  }
  // `--debug` surfaces the run's Sentry trace id, but `--no-score` /
  // `--no-telemetry` turn off the Sentry reporting that produces it — so the
  // combination can never do anything. Reject it instead of silently no-op'ing.
  if (flags.debug && (flags.score === false || flags.telemetry === false)) {
    const disablingFlag = flags.score === false ? "--no-score" : "--no-telemetry";
    throw new CliInputError(
      `Cannot combine --debug with ${disablingFlag}; ${disablingFlag} disables the Sentry reporting --debug needs to capture a trace.`,
    );
  }
};
