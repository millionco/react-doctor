import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import {
  CANONICAL_GITHUB_URL,
  formatErrorChain,
  formatReactDoctorError,
  highlighter,
  isReactDoctorError,
} from "@react-doctor/core";
import type { HandleErrorOptions } from "@react-doctor/core";

/**
 * Effect-typed renderer: every message routes through `Console.error`
 * so test runs can swap `Console` to a capture sink and the output
 * appears in the right stream (stderr) in production. Lines stay
 * red-highlighted (matches the historical `consoleLogger.error`
 * contract) so the user sees a clearly distinguished error block.
 */
export const handleErrorEffect = (error: unknown): Effect.Effect<void> =>
  Effect.gen(function* () {
    yield* Console.error("");
    yield* Console.error(
      highlighter.error("Something went wrong. Please check the error below for more details."),
    );
    yield* Console.error(
      highlighter.error(
        `If the problem persists, please open an issue at ${CANONICAL_GITHUB_URL}/issues.`,
      ),
    );
    yield* Console.error("");
    yield* Console.error(
      highlighter.error(
        isReactDoctorError(error) ? formatReactDoctorError(error) : formatErrorChain(error),
      ),
    );
    yield* Console.error("");
  });

/**
 * Sync façade for legacy callers (top-level CLI command bodies that
 * aren't yet Effect-typed). Bridges via `Effect.runSync` so the
 * underlying Console writes happen exactly like the Effect path.
 */
export const handleError = (
  error: unknown,
  options: HandleErrorOptions = { shouldExit: true },
): void => {
  Effect.runSync(handleErrorEffect(error));
  if (options.shouldExit !== false) {
    process.exit(1);
  }
  process.exitCode = 1;
};
