export const hasIncompleteScoreAnalysis = (skippedChecks: ReadonlyArray<string>): boolean =>
  skippedChecks.includes("lint") || skippedChecks.includes("dead-code");
