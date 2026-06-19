import * as Sentry from "@sentry/node";
import { highlighter } from "@react-doctor/core";
import { getLastRunTraceId } from "./active-run-trace.js";

/**
 * The `--debug` end-of-run line, pure so it's testable without the Sentry SDK.
 * Mirrors the crash-reference phrasing in `handle-error.ts` ("mention this when
 * reporting") so users learn one habit for both paths. A `null` trace says why,
 * so `--debug` never silently does nothing.
 */
export const buildDebugTraceMessage = (traceId: string | null): string =>
  traceId === null
    ? "Sentry trace unavailable for this run (no trace was recorded)."
    : `Sentry trace (mention this when reporting): ${traceId}`;

/**
 * Prints the run's Sentry trace id to stderr at the end of a `--debug` run, so
 * maintainers can pull the full trace from a pasted id. Runs from the process
 * `exit` handler, so it's the last line on both the success path and the error
 * funnels (which `process.exit()` before the promise chain could resume).
 *
 * Writes straight to `process.stderr` (not `Console`) for three reasons: the
 * exit handler is synchronous, JSON mode patches the global console to no-ops —
 * a diagnostic the user explicitly asked for must survive that — and stderr
 * keeps `--json` / `--score` stdout machine-clean. The write is wrapped because
 * a diagnostic must never throw out of an exit handler.
 */
export const printDebugTrace = (): void => {
  // Sentry off ⇒ nothing to surface. `--debug` with `--no-score` /
  // `--no-telemetry` is rejected up front (validateModeFlags), so this is only
  // reachable from tests / the library, where a debug line would be noise.
  if (!Sentry.isInitialized()) return;
  try {
    process.stderr.write(`${highlighter.dim(buildDebugTraceMessage(getLastRunTraceId()))}\n`);
  } catch {}
};
