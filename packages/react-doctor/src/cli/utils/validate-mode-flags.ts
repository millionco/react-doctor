import { CliInputError } from "./cli-input-error.js";
import type { InspectFlags } from "./inspect-flags.js";

// "The user asked for a diff scope via the deprecated `--diff`" — `false` /
// `"false"` / `""` mean "force a full scan", so they don't count as a mode.
const usedDiffAlias = (flags: InspectFlags): boolean =>
  flags.diff !== undefined && flags.diff !== false && flags.diff !== "false" && flags.diff !== "";

const usedScope = (flags: InspectFlags): boolean =>
  typeof flags.scope === "string" && flags.scope.length > 0;

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
  if (flags.score && flags.json) {
    throw new CliInputError("Cannot combine --score and --json; pick one output mode.");
  }
  if (flags.score && flags.telemetry === false) {
    throw new CliInputError(
      "Cannot combine --score with --no-telemetry; --score prints the score that --no-telemetry disables.",
    );
  }
};
