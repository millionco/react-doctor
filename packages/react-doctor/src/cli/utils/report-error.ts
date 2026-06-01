import * as Sentry from "@sentry/node";
import { getActiveRunTrace } from "./active-run-trace.js";
import { buildSentryScope } from "./build-sentry-scope.js";
import { SENTRY_FLUSH_TIMEOUT_MS } from "./constants.js";

/**
 * Sends an error to Sentry — enriched with a fresh snapshot of the current run
 * (version, platform, CI/agent, invocation, scanned project) and, when a run
 * transaction is in flight, linked to its trace via the scope's propagation
 * context so the crash and its transaction share a `trace_id` — then waits for
 * delivery before the caller exits. The CLI tears down synchronously after
 * rendering an error, so the awaited `flush` is what actually gets the event
 * (and any in-flight transaction) off the machine.
 *
 * Returns the Sentry event id so the caller can surface it as a reference the
 * user can quote when reporting the bug; returns `undefined` when Sentry was
 * never initialized (`--no-score`, tests, or a missing DSN) or delivery failed.
 * Swallows any transport failure so telemetry can never mask the user's
 * original error.
 */
export const reportErrorToSentry = async (error: unknown): Promise<string | undefined> => {
  if (!Sentry.isInitialized()) return undefined;
  try {
    const { tags, contexts } = buildSentryScope();
    const runTrace = getActiveRunTrace();
    const eventId = Sentry.withScope((scope) => {
      for (const [name, context] of Object.entries(contexts)) scope.setContext(name, context);
      scope.setTags(tags);
      if (runTrace) {
        scope.setPropagationContext({
          traceId: runTrace.traceId,
          parentSpanId: runTrace.spanId,
          sampled: runTrace.sampled,
          sampleRand: Math.random(),
        });
      }
      return Sentry.captureException(error);
    });
    await Sentry.flush(SENTRY_FLUSH_TIMEOUT_MS);
    return eventId;
  } catch {
    return undefined;
  }
};
