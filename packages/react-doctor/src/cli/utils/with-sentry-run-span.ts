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
 * Clears the module-level run-scoped Sentry state — the current scanned project
 * and the active run trace. `inspect()` calls this at the start of every run and
 * again after a clean one, so a prior or just-finished scan can't attach its
 * project tags / trace to a later run or to a non-scan error (e.g.
 * inspectAction's post-loop finalize/handoff steps). A thrown scan error skips
 * the post-run reset, leaving the state for the command catch to attribute and
 * link the crash. Concurrent batch members (`concurrentScan`) never touch this
 * state — they neither write nor reset it. Safe to call when Sentry is off (the
 * refs are read only when an event is built).
 */
export const resetSentryRunState = (): void => {
  setSentryProjectInfo(null);
  setActiveRunTrace(null);
};

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
 * ended). `inspect()` owns clearing it (and the scanned project): it resets the
 * state right after a clean run and at the start of the next one, so the trace
 * is never attached to a non-scan error; on a thrown error the state is left in
 * place for the command catch, then the process exits.
 *
 * A `concurrentScan` (one member of the CLI's multi-project pool) still gets
 * its own root span, but skips recording the active run trace — the module-
 * level handle has single-scan semantics, and overlapping writers would link a
 * crash to an arbitrary sibling's trace.
 */
export const withSentryRunSpan = <T>(
  run: (rootSpan: SentryRootSpan) => Promise<T>,
  options: { concurrentScan?: boolean } = {},
): Promise<T> => {
  if (!isSentryTracingEnabled()) return run(undefined);
  const { tags } = buildSentryScope();
  const command = typeof tags.command === "string" ? tags.command : "inspect";
  return Sentry.startSpan(
    { name: `react-doctor ${command}`, op: "cli.inspect", attributes: toSpanAttributes(tags) },
    (rootSpan) => {
      if (options.concurrentScan !== true) {
        const spanContext = rootSpan.spanContext();
        setActiveRunTrace({
          traceId: spanContext.traceId,
          spanId: spanContext.spanId,
          sampled: (spanContext.traceFlags & TRACE_FLAG_SAMPLED) === TRACE_FLAG_SAMPLED,
        });
      }
      return run(rootSpan);
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
 *
 * A `concurrentScan` only sets the span attributes: the module-level project
 * ref has single-scan semantics, and overlapping writers would stamp events
 * and metrics with an arbitrary sibling's project. Wide events keep full
 * attribution (they ride the span); per-emit metrics simply omit the project
 * shape during a concurrent batch (absent, never wrong).
 */
export const recordSentryProjectContext = (
  projectInfo: ProjectInfo,
  rootSpan: SentryRootSpan,
  options: { concurrentScan?: boolean } = {},
): void => {
  if (options.concurrentScan !== true) setSentryProjectInfo(projectInfo);
  rootSpan?.setAttributes(toSpanAttributes(buildSentryProjectContext(projectInfo).tags));
  // Metrics emitted after discovery (`project.detected`, `scan.completed`,
  // `rule.fired`, ...) pick the project shape up via `getSentryProjectInfo()`
  // when `record-metric.ts` rebuilds the scope per emit — so it also clears
  // correctly on `resetSentryRunState`, exactly like event tags do.
};
