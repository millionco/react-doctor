export interface SkippedCheckInput {
  readonly didLintFail: boolean;
  readonly lintFailureReason: string | null;
  readonly lintPartialFailures: ReadonlyArray<string>;
  readonly didDeadCodeFail: boolean;
  readonly deadCodeFailureReason: string | null;
}

export interface SkippedCheckSummary {
  readonly skippedChecks: string[];
  readonly skippedCheckReasons: Record<string, string>;
}

/**
 * Single source of truth for the skipped-check accounting shared by the
 * CLI renderer (`react-doctor/src/inspect.ts → finalizeAndRender`) and the
 * programmatic shell (`@react-doctor/api → diagnose()`). Both surface a
 * failed lint / dead-code pass instead of a false "all clear", so the
 * branch logic lives here once.
 */
export const buildSkippedChecks = (input: SkippedCheckInput): SkippedCheckSummary => {
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

  return { skippedChecks, skippedCheckReasons };
};
