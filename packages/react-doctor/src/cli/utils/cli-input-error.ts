/**
 * A mistake in *how the CLI was invoked* — a malformed `<file>:<line>`
 * argument, mutually exclusive flags, or an unknown `--project` name. This is
 * user input, not a react-doctor bug, so `isExpectedUserError` routes it
 * through `handleUserError`: a clean, single-line message with no Sentry
 * report and no "Something went wrong, open a prefilled issue" block.
 *
 * The `message` is rendered verbatim, so it must read as a complete,
 * human-readable sentence that tells the user how to fix their invocation.
 */
export class CliInputError extends Error {
  override readonly name = "CliInputError";
}
