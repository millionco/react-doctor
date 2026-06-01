import { NODE_ARGUMENT_COUNT } from "./constants.js";

/**
 * 12-factor CLI Apps (#1, "Great help is essential"): `mycli help` and
 * `mycli help <command>` must display help. Commander doesn't wire this
 * up once the root command has its own default action plus a positional
 * argument — it treats a leading `help` as the `[directory]` to scan,
 * which then errors with "No React project found in ./help".
 *
 * We rewrite the argv up front so the existing `--help` paths handle it:
 *   `react-doctor help`         -> `react-doctor --help`
 *   `react-doctor help install` -> `react-doctor install --help`
 *
 * Only a *leading* `help` token is rewritten, so a flag value such as
 * `--project help` is never mistaken for the help command. The target is
 * the first non-flag token after `help`, so intervening flags like
 * `help --no-color install` still resolve to `install`. An unknown target
 * (`help bogus`) falls back to root help rather than erroring.
 */
export const normalizeHelpInvocation = (
  argv: readonly string[],
  knownCommands: readonly string[],
): string[] => {
  const nodeArguments = argv.slice(0, NODE_ARGUMENT_COUNT);
  const userArguments = argv.slice(NODE_ARGUMENT_COUNT);
  if (userArguments[0] !== "help") return [...argv];

  const target = userArguments.slice(1).find((argument) => !argument.startsWith("-"));
  if (target !== undefined && knownCommands.includes(target)) {
    return [...nodeArguments, target, "--help"];
  }
  return [...nodeArguments, "--help"];
};
