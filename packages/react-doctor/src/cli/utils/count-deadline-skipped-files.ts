import { sumFileCountsMatching } from "./sum-file-counts-matching.js";

// Total source files skipped because the `--max-duration` budget ran out,
// summed from the partial-failure strings on `InspectResult.lintPartialFailures`
// (message built in core's `spawn-batches.ts`). Rides the wide event as
// `lint.deadlineSkippedFileCount` — the "did the budget actually truncate a
// scan" signal that the `scan.maxDurationMs` config dimension alone can't
// answer. Same anchored-prefix parsing as `countDroppedLintFiles`, keeping the
// signal contained to one CLI util instead of plumbing a structured count
// through the Linter → run-inspect → cache-payload chain.
const DEADLINE_SKIPPED_MESSAGE_PATTERN = /^(\d+) file\(s\) skipped — max scan duration reached/;

export const countDeadlineSkippedFiles = (lintPartialFailures: ReadonlyArray<string>): number =>
  sumFileCountsMatching(lintPartialFailures, DEADLINE_SKIPPED_MESSAGE_PATTERN);
