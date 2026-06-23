export interface WorkerTelemetry {
  /** The lint worker count to report, or `undefined` when neither source knows it. */
  readonly workerCount: number | undefined;
  /** Whether the lint pass fanned out to more than one worker. */
  readonly parallel: boolean;
}

/**
 * Projects the resolved lint worker count into the `(workerCount, parallel)`
 * telemetry pair. `resolvedWorkerCount` is the count the scan actually fanned
 * out to (`InspectOutput.scanConcurrency`); `pinnedConcurrency` is the caller's
 * `inspect({ concurrency })` pin, used as the fallback when no scan resolved a
 * count (the pre-scan failure path, or a cache entry persisted before the
 * resolved count was tracked). `parallel` is derived from the count — NOT from
 * whether a count was pinned — so the common auto path (no pin) still reports
 * parallelism correctly instead of always reading `false`.
 */
export const resolveWorkerTelemetry = (
  resolvedWorkerCount: number | undefined,
  pinnedConcurrency: number | undefined,
): WorkerTelemetry => {
  const workerCount = resolvedWorkerCount ?? pinnedConcurrency;
  return { workerCount, parallel: workerCount !== undefined && workerCount > 1 };
};
