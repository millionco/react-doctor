import { highlighter } from "@react-doctor/core";
import { getLastRunTraceId } from "./active-run-trace.js";
import { isTelemetryEnabled } from "./is-telemetry-enabled.js";

/**
 * The `--debug` end-of-run line, pure so it's testable without a live exporter.
 * Mirrors the crash-reference phrasing in `handle-error.ts` ("mention this when
 * reporting") so users learn one habit for both paths. A `null` trace says why,
 * so `--debug` never silently does nothing.
 */
export const buildDebugTraceMessage = (traceId: string | null): string =>
  traceId === null
    ? "Trace unavailable for this run (no trace was recorded)."
    : `Trace (mention this when reporting): ${traceId}`;

/**
 * Prints the run's trace id to stderr at the end of a `--debug` run, so
 * maintainers can pull the full trace from a pasted id. Runs from the process
 * `exit` handler, so it's the last line on both the success path and the error
 * funnels (which `process.exit()` before the promise chain could resume).
 *
 * The id now identifies the trace in Axiom rather than Sentry — spans moved
 * there — and the same id is attached to any Sentry crash report for this run
 * (see `report-error.ts`), so one pasted id resolves in both.
 *
 * Writes straight to `process.stderr` (not `Console`) for three reasons: the
 * exit handler is synchronous, JSON mode patches the global console to no-ops —
 * a diagnostic the user explicitly asked for must survive that — and stderr
 * keeps `--json` / `--score` stdout machine-clean. The write is wrapped because
 * a diagnostic must never throw out of an exit handler.
 */
export const printDebugTrace = (): void => {
  // Telemetry off ⇒ nothing to surface. `--debug` with `--no-score` /
  // `--no-telemetry` is rejected up front (validateModeFlags), so this is only
  // reachable from tests / the library, where a debug line would be noise.
  if (!isTelemetryEnabled()) return;
  try {
    process.stderr.write(`${highlighter.dim(buildDebugTraceMessage(getLastRunTraceId()))}\n`);
  } catch {}
};
