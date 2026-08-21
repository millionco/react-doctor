import type { ProjectInfo } from "@react-doctor/core";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import type * as Tracer from "effect/Tracer";
import { recordRunTraceId, setActiveRunTrace } from "./active-run-trace.js";
import { buildSentryProjectContext, setSentryProjectInfo } from "./build-sentry-project-context.js";
import { buildSentryScope } from "./build-sentry-scope.js";
import { NANOSECONDS_PER_MILLISECOND } from "./constants.js";
import { getTelemetryContext } from "./telemetry-runtime.js";
import { toSpanAttributes } from "./to-span-attributes.js";

export type RunRootSpan = Tracer.Span | undefined;

export interface WithRunSpanOptions {
  readonly concurrentScan?: boolean;
  readonly mapErrorForSpan?: (error: unknown) => unknown;
}

/**
 * Ends the run span without letting a telemetry failure change the run's
 * outcome — the invariant every other emit site here already holds.
 *
 * The failure path is the reason this matters most: a throw from `end` there
 * would replace the user's original scan error, so a project-config mistake
 * could surface as an exporter stack trace, be reclassified as a crash, and get
 * reported as one.
 */
const endSpanSafely = (span: Tracer.Span, exit: Exit.Exit<unknown, unknown>): void => {
  try {
    span.end(BigInt(Date.now()) * NANOSECONDS_PER_MILLISECOND, exit);
  } catch {}
};

/**
 * Clears the module-level run-scoped telemetry state — the current scanned
 * project and the active run trace. `inspect()` calls this at the start of every
 * run and again after a clean one, so a prior or just-finished scan can't attach
 * its project tags / trace to a later run or to a non-scan error (e.g.
 * inspectAction's post-loop finalize/handoff steps). A thrown scan error skips
 * the post-run reset, leaving the state for the command catch to attribute and
 * link the crash. Concurrent batch members (`concurrentScan`) never touch this
 * state — they neither write nor reset it. Safe to call when telemetry is off
 * (the refs are read only when an event is built).
 */
export const resetSentryRunState = (): void => {
  setSentryProjectInfo(null);
  setActiveRunTrace(null);
};

/**
 * Runs an inspect invocation inside a root span so each `react-doctor` run is a
 * first-class trace with timing and the run snapshot as attributes. The span is
 * handed to `run` so the scan's Effect spans parent under it and so the wide
 * event can be stamped onto it once the outcome is known.
 *
 * A no-op pass-through when telemetry is off (`--no-telemetry`, tests, or an
 * unconfigured build) — `run` receives `undefined` and no span is created, so
 * there's no added exit latency.
 *
 * The span is created against the shared telemetry context rather than a
 * freshly-provided layer, so it lives in the same tracer as the scan program's
 * spans; see `telemetry-runtime.ts` for why that matters. It is started and
 * ended manually because the body it wraps is a promise-returning imperative
 * function, not an Effect — the same shape the Sentry inactive span had.
 *
 * While the span runs, its trace context is recorded as the active run trace so
 * `reportErrorToSentry` can attach a crash thrown during the scan back to this
 * trace (errors surface in the command catch, after the span has ended).
 *
 * A `concurrentScan` (one member of the CLI's multi-project pool) still gets its
 * own root span, but skips recording the active run trace — the module-level
 * handle has single-scan semantics, and overlapping writers would link a crash
 * to an arbitrary sibling's trace.
 */
export const withRunSpan = async <T>(
  run: (rootSpan: RunRootSpan) => Promise<T>,
  options: WithRunSpanOptions = {},
): Promise<T> => {
  const telemetryContext = getTelemetryContext();
  if (telemetryContext === null) return run(undefined);
  const { tags } = buildSentryScope();
  const command = typeof tags.command === "string" ? tags.command : "inspect";

  let rootSpan: Tracer.Span;
  try {
    rootSpan = Effect.runSync(
      Effect.makeSpan(`react-doctor ${command}`, { attributes: toSpanAttributes(tags) }).pipe(
        Effect.provideContext(telemetryContext),
      ),
    );
  } catch {
    return run(undefined);
  }

  // Remembered for the `--debug` end-of-run print, which reads it after the span
  // has ended and the run-scoped error-linking handle has been reset.
  recordRunTraceId(rootSpan.traceId);
  if (options.concurrentScan !== true) {
    setActiveRunTrace({
      traceId: rootSpan.traceId,
      spanId: rootSpan.spanId,
      sampled: rootSpan.sampled,
    });
  }

  try {
    const result = await run(rootSpan);
    endSpanSafely(rootSpan, Exit.void);
    return result;
  } catch (error) {
    endSpanSafely(rootSpan, Exit.fail(options.mapErrorForSpan?.(error) ?? error));
    throw error;
  }
};

/**
 * Records the scanned project (discovered in the `beforeLint` hook): remembers
 * it for the lazy Sentry error-capture path (`buildSentryScope` folds it into
 * exception events) and for per-emit metric attributes, and sets it on the run's
 * root span so the trace carries the project shape too. Always cheap — the span
 * attributes are skipped when `rootSpan` is absent (telemetry off), and storing
 * the info is a plain assignment.
 *
 * A `concurrentScan` only sets the span attributes: the module-level project ref
 * has single-scan semantics, and overlapping writers would stamp events and
 * metrics with an arbitrary sibling's project. Wide events keep full attribution
 * (they ride the span); per-emit metrics simply omit the project shape during a
 * concurrent batch (absent, never wrong).
 */
export const recordSentryProjectContext = (
  projectInfo: ProjectInfo,
  rootSpan: RunRootSpan,
  options: { concurrentScan?: boolean } = {},
): void => {
  if (options.concurrentScan !== true) setSentryProjectInfo(projectInfo);
  if (rootSpan === undefined) return;
  for (const [key, value] of Object.entries(
    toSpanAttributes(buildSentryProjectContext(projectInfo).tags),
  )) {
    rootSpan.attribute(key, value);
  }
  // Metrics emitted after discovery (`project.detected`, `scan.completed`,
  // `rule.fired`, ...) pick the project shape up via `getSentryProjectInfo()`
  // when `record-metric.ts` rebuilds the scope per emit — so it also clears
  // correctly on `resetSentryRunState`, exactly like event tags do.
};
