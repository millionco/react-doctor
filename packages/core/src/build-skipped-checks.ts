export interface BuildSkippedChecksInput {
  readonly didLintFail: boolean;
  readonly lintFailureReason: string | null;
  readonly lintPartialFailures: ReadonlyArray<string>;
  readonly didDeadCodeFail: boolean;
  readonly deadCodeFailureReason: string | null;
}

export interface SkippedChecksResult {
  readonly skippedChecks: string[];
  readonly skippedCheckReasons?: Record<string, string>;
}

export const buildSkippedChecks = (input: BuildSkippedChecksInput): SkippedChecksResult => {
  const skippedChecks: string[] = [];
  if (input.didLintFail) skippedChecks.push("lint");
  if (input.didDeadCodeFail) skippedChecks.push("dead-code");

  const skippedCheckReasons: Record<string, string> = {};
  if (input.didLintFail && input.lintFailureReason !== null) {
    skippedCheckReasons.lint = input.lintFailureReason;
  } else if (input.lintPartialFailures.length > 0) {
    skippedCheckReasons["lint:partial"] = input.lintPartialFailures.join("; ");
  }
  if (input.didDeadCodeFail && input.deadCodeFailureReason !== null) {
    skippedCheckReasons["dead-code"] = input.deadCodeFailureReason;
  }

  return {
    skippedChecks,
    ...(Object.keys(skippedCheckReasons).length > 0 ? { skippedCheckReasons } : {}),
  };
};
