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
