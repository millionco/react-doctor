// Milliseconds left before an absolute epoch deadline, floored at zero.
// The one primitive behind every `--max-duration` consumer: run-inspect's
// phase cap, spawn-batches' skip-unstarted-batches check, and the CLI's
// shared per-project budget.
export const remainingDeadlineBudgetMs = (deadlineEpochMs: number): number =>
  Math.max(deadlineEpochMs - Date.now(), 0);
