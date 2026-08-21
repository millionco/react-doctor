export const formatSkippedCheckLabel = (skippedCheck: string): string =>
  skippedCheck === "dead-code" ? "maintainability" : skippedCheck;
