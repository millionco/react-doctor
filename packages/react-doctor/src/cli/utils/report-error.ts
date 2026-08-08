import * as Sentry from "@sentry/node";
import { isReactDoctorError } from "@react-doctor/core";
import { getActiveRunTrace, recordRunTraceId } from "./active-run-trace.js";
import { buildSentryScope } from "./build-sentry-scope.js";
import { METRIC, SENTRY_FLUSH_TIMEOUT_MS } from "./constants.js";
import { shutdownTelemetry } from "./telemetry-runtime.js";
import { isExpectedUserError } from "./is-expected-user-error.js";
import { recordCount } from "./record-metric.js";
import { getRunId } from "./run-id.js";

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
  // Expected user errors (see `isExpectedUserError`) are the user's
  // project/input, not a bug. Drop them before the metric + capture so they
  // never become a Sentry crash or inflate the alertable error rate — the one
  // choke point that covers every entry point regardless of caller-side gating.
  if (isExpectedUserError(error)) return undefined;
  try {
    const { tags, contexts } = buildSentryScope();

    // Count the failure as a metric too — a clean, alertable error rate keyed by
    // command + the tagged `ReactDoctorError` reason (or the legacy thrown
    // class name), complementing the captured Sentry issue.
    let reason = "unknown";
    if (isReactDoctorError(error)) reason = error.reason._tag;
    else if (error instanceof Error) reason = error.name;
    recordCount(METRIC.cliError, 1, {
      command: typeof tags.command === "string" ? tags.command : undefined,
      reason,
    });

    const runTrace = getActiveRunTrace();
    const eventId = Sentry.withScope((scope) => {
      for (const [name, context] of Object.entries(contexts)) scope.setContext(name, context);
      scope.setTags(tags);
      if (runTrace) {
        // Spans live in Axiom now, so Sentry's own trace linkage no longer
        // reaches them. Carry the Axiom trace id and the run id so a Sentry
        // issue can be pivoted straight into the run's trace — as a *context*,
        // not tags: both are unique per run, and tags are an indexed,
        // low-cardinality dimension (see AGENTS.md on `runId`).
        scope.setContext("axiom", { traceId: runTrace.traceId, runId: getRunId() });
        scope.setPropagationContext({
          traceId: runTrace.traceId,
          parentSpanId: runTrace.spanId,
          sampled: runTrace.sampled,
          sampleRand: Math.random(),
        });
      }
      // Surface the trace this crash is attached to for `--debug`, even when no
      // scan span ran (a pre-scan throw has no run trace, but the captured event
      // still belongs to the scope's trace). When `runTrace` exists this is the
      // same id; otherwise it's the scope's own (matching the captured event).
      recordRunTraceId(scope.getPropagationContext().traceId);
      return Sentry.captureException(error);
    });
    // The crash counter (`cli.error`) above lands in Effect's metric registry,
    // so the Axiom flush has to run on this path too — not just Sentry's.
    await Promise.all([Sentry.flush(SENTRY_FLUSH_TIMEOUT_MS), shutdownTelemetry()]);
    return eventId;
  } catch {
    return undefined;
  }
};
