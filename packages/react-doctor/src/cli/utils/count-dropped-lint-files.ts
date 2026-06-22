const DROPPED_FILES_MESSAGE_PATTERN = /^(\d+) file\(s\) failed to lint and were skipped/;

export const countDroppedLintFiles = (lintPartialFailures: ReadonlyArray<string>): number =>
  lintPartialFailures.reduce((total, message) => {
    const match = DROPPED_FILES_MESSAGE_PATTERN.exec(message);
    return match ? total + Number(match[1]) : total;
  }, 0);
