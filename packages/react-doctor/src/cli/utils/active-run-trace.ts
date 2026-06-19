export interface ActiveRunTrace {
  readonly traceId: string;
  readonly spanId: string;
  readonly sampled: boolean;
}

// Trace context of the in-flight run transaction. Errors are caught *after* the
// run transaction's span has ended (in the command catch blocks), so the active
// span context is already gone by capture time; this module-level handle lets
// `reportErrorToSentry` re-attach the error to the run's trace via the scope's
// propagation context, so the crash and its transaction share a `trace_id` in
// Sentry. Set when the transaction starts, cleared when it finishes cleanly so
// a later unrelated error can't link to a completed run.
let activeRunTrace: ActiveRunTrace | null = null;

export const setActiveRunTrace = (trace: ActiveRunTrace | null): void => {
  activeRunTrace = trace;
};

export const getActiveRunTrace = (): ActiveRunTrace | null => activeRunTrace;

// The most recent run's trace id, kept for the `--debug` end-of-run print.
// Unlike `activeRunTrace` (the error-linking handle, cleared after each run by
// `resetSentryRunState`), this persists past the reset so it can be read once
// the command has finished and the trace has flushed. Recorded for every run
// span — including a concurrent workspace batch, where the last member to start
// wins; any one project's trace is a fine entry point for a debug pointer.
let lastRunTraceId: string | null = null;

export const recordRunTraceId = (traceId: string): void => {
  lastRunTraceId = traceId;
};

export const getLastRunTraceId = (): string | null => lastRunTraceId;
