// Total source files the lint pass dropped, summed from the partial-failure
// strings on `InspectResult.lintPartialFailures`. Each dropped-files event
// emits exactly one message of the shape `"N file(s) failed to lint and were
// skipped …"` (built in core's `spawn-batches.ts`); other partial-failure
// strings (e.g. the react-hooks-js plugin-drop note) don't match the prefix
// and contribute 0. The count is more sensitive than the message count
// (`lintPartialFailureCount`) for the LPT kill metric — a batch that strands
// the timeout-tripping bucket can drop many files in a single message — so it
// rides the wide event as `lint.droppedFileCount`. Parsing the anchored prefix
// keeps the signal contained to one CLI util instead of plumbing a structured
// count through the Linter → run-inspect → cache-payload chain.
const DROPPED_FILES_MESSAGE_PATTERN = /^(\d+) file\(s\) failed to lint and were skipped/;

export const countDroppedLintFiles = (lintPartialFailures: ReadonlyArray<string>): number =>
  lintPartialFailures.reduce((total, message) => {
    const match = DROPPED_FILES_MESSAGE_PATTERN.exec(message);
    return match ? total + Number(match[1]) : total;
  }, 0);
