// Sums the captured file counts from partial-failure messages matching an
// anchored `^(\d+) file\(s\) …` pattern (built in core's `spawn-batches.ts`).
// Non-matching strings (e.g. the react-hooks-js plugin-drop note) contribute
// 0. Shared by `countDroppedLintFiles` and `countDeadlineSkippedFiles`, which
// differ only in which message prefix they anchor on.
export const sumFileCountsMatching = (
  messages: ReadonlyArray<string>,
  countPattern: RegExp,
): number =>
  messages.reduce((total, message) => {
    const match = countPattern.exec(message);
    return match ? total + Number(match[1]) : total;
  }, 0);
