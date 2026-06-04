import { CliInputError } from "./cli-input-error.js";
import { NODE_ARGUMENT_COUNT } from "./constants.js";

// Flags removed in the CLI simplification, each mapped to its replacement.
// `stripUnknownCliFlags` would otherwise drop these silently before Commander
// parses, so an upgrading user's `--full` would quietly run a normal (possibly
// diff) scan and `--explain` would be ignored entirely. Detect them in raw argv
// and fail loudly with migration guidance instead.
const REMOVED_FLAGS: ReadonlyMap<string, string> = new Map([
  ["--full", "use `--diff false` to force a full scan"],
  ["--explain", "use the `why <file>:<line>` command"],
  ["--why", "use the `why <file>:<line>` command"],
  ["--pr-comment", "the GitHub Action posts the PR comment for you; remove this flag"],
]);

/**
 * Throws a clean {@link CliInputError} when a removed flag appears in argv,
 * pointing to its replacement. Run before flag stripping so a removed flag is a
 * loud, actionable error rather than a silent no-op.
 */
export const assertNoRemovedFlags = (argv: ReadonlyArray<string>): void => {
  for (const argument of argv.slice(NODE_ARGUMENT_COUNT)) {
    // Everything after `--` is positional, never a flag.
    if (argument === "--") return;
    const optionName = argument.includes("=") ? argument.slice(0, argument.indexOf("=")) : argument;
    const guidance = REMOVED_FLAGS.get(optionName);
    if (guidance !== undefined) {
      throw new CliInputError(`\`${optionName}\` was removed — ${guidance}.`);
    }
  }
};
