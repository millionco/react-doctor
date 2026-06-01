import * as Sentry from "@sentry/node";
import type { ProjectInfo } from "@react-doctor/core";
import { isSentryTracingEnabled } from "../../instrument.js";
import { setActiveRunTrace } from "./active-run-trace.js";
import { buildSentryScope } from "./build-sentry-scope.js";
import { buildSentryProjectContext, setSentryProjectInfo } from "./build-sentry-project-context.js";
import { TRACE_FLAG_SAMPLED } from "./constants.js";
import { toSpanAttributes } from "./to-span-attributes.js";

export type SentryRootSpan = ReturnType<typeof Sentry.startInactiveSpan> | undefined;

/**
 * Runs an inspect invocation inside a Sentry root span (transaction) so each
 * `react-doctor` run is a first-class trace with timing and the run snapshot as
 * attributes. The span is handed to `run` so the Effect→Sentry tracer bridge
 * can parent its spans under it.
 *
 * A no-op pass-through when Sentry performance tracing is off (Sentry disabled,
 * `--no-score`, tests, or `SENTRY_TRACES_SAMPLE_RATE=0`) — `run` receives
 * `undefined` and no transaction is created, so there's no added exit latency.
 *
 * While the span runs, its trace context is recorded as the active run trace so
 * `reportErrorToSentry` can attach a crash thrown during the scan back to this
 * transaction's trace (errors surface in the command catch, after the span has
 * ended). The handle is cleared only on success — on error it's left in place
 * for the catch, then the process exits.
 */
export const withSentryRunSpan = <T>(run: (rootSpan: SentryRootSpan) => Promise<T>): Promise<T> => {
  if (!isSentryTracingEnabled()) return run(undefined);
  const { tags } = buildSentryScope();
  const command = typeof tags.command === "string" ? tags.command : "inspect";
  return Sentry.startSpan(
    { name: `react-doctor ${command}`, op: "cli.inspect", attributes: toSpanAttributes(tags) },
    async (rootSpan) => {
      const spanContext = rootSpan.spanContext();
      setActiveRunTrace({
        traceId: spanContext.traceId,
        spanId: spanContext.spanId,
        sampled: (spanContext.traceFlags & TRACE_FLAG_SAMPLED) === TRACE_FLAG_SAMPLED,
      });
      const result = await run(rootSpan);
      // Reached only on success; on a thrown error the handle stays set so the
      // command catch can link the crash to this trace.
      setActiveRunTrace(null);
      return result;
    },
  );
};

/**
 * Records the scanned project (discovered in the `beforeLint` hook) for Sentry:
 * remembers it for the lazy error-capture path (`buildSentryScope` folds it into
 * exception events) and, when tracing is live, sets it as attributes on the
 * run's root span so the transaction/trace carries the project shape too.
 * Always cheap — the span attribute set is skipped when `rootSpan` is absent
 * (tracing off), and storing the info is a plain assignment.
 */
export const recordSentryProjectContext = (
  projectInfo: ProjectInfo,
  rootSpan: SentryRootSpan,
): void => {
  setSentryProjectInfo(projectInfo);
  rootSpan?.setAttributes(toSpanAttributes(buildSentryProjectContext(projectInfo).tags));
};
