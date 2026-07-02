import { MIN_REMAINING_SCAN_BUDGET_MS } from "./constants.js";

// Remaining `--max-duration` budget for a project scan starting now. The
// invocation-wide deadline is fixed once in the `inspect` command, so
// concurrent workspace projects share ONE budget instead of each starting a
// fresh one. `undefined` when no budget was set.
export const remainingScanBudgetMs = (deadlineEpochMs: number | null): number | undefined =>
  deadlineEpochMs === null
    ? undefined
    : Math.max(deadlineEpochMs - Date.now(), MIN_REMAINING_SCAN_BUDGET_MS);
