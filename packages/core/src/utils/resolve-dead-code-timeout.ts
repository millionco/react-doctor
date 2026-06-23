import {
  DEAD_CODE_PHASE_TIMEOUT_OVER_WORKER_MS,
  DEAD_CODE_TIMEOUT_CEILING_MS,
  DEAD_CODE_TIMEOUT_MS_PER_SOURCE_FILE,
  DEAD_CODE_WORKER_TIMEOUT_MS,
} from "../constants.js";

interface DeadCodeTimeoutInput {
  /** Source files deslop will analyze — the dominant driver of its runtime. */
  readonly sourceFileCount: number;
  /**
   * Cores the dead-code parse pool will actually use. Equals `fullConcurrency`
   * on the sequential (default) path; smaller only when dead-code is overlapped
   * with lint and the two split the budget — fewer cores ⇒ proportionally
   * longer, so the budget scales up to match.
   */
  readonly deadCodeConcurrency: number;
  /** The scan's full worker budget; `deadCodeConcurrency` ≤ this. */
  readonly fullConcurrency: number;
}

/**
 * Budget for the dead-code phase, scaled to the work. deslop's graph build is
 * CPU-bound and roughly linear in file count, so a fixed 120s cap is too tight
 * for a large repo (where the pass legitimately runs that long) and is then
 * tipped over by any concurrent load — silently dropping every dead-code
 * finding. Scaling the budget with file count (and inversely with the core
 * share when overlapped) lets the pass complete, while the ceiling still
 * reclaims a genuinely wedged worker. Returns the in-worker SIGKILL deadline
 * and the Effect-side phase backstop that sits a margin above it.
 */
export const resolveDeadCodeTimeout = (
  input: DeadCodeTimeoutInput,
): { workerTimeoutMs: number; phaseTimeoutMs: number } => {
  const coreShareFactor = Math.max(
    1,
    input.fullConcurrency / Math.max(1, input.deadCodeConcurrency),
  );
  const workerTimeoutMs = Math.min(
    DEAD_CODE_TIMEOUT_CEILING_MS,
    Math.max(
      DEAD_CODE_WORKER_TIMEOUT_MS,
      Math.ceil(input.sourceFileCount * DEAD_CODE_TIMEOUT_MS_PER_SOURCE_FILE * coreShareFactor),
    ),
  );
  return {
    workerTimeoutMs,
    phaseTimeoutMs: workerTimeoutMs + DEAD_CODE_PHASE_TIMEOUT_OVER_WORKER_MS,
  };
};
