import { MILLISECONDS_PER_SECOND } from "../constants.js";

interface AnalysisFailureState {
  readonly didFail: boolean;
  readonly reason: string | null;
}

interface ResolveScanCompletionInput {
  readonly lintDidFail: boolean;
  readonly deadCodeFailure: AnalysisFailureState;
  readonly suppressScanSummary: boolean;
  readonly scannedFilesLabel: string;
  readonly scanElapsedMilliseconds: number;
  readonly workerCountSuffix: string;
}

interface ScanProgressCompletion {
  readonly action: "unchanged" | "fail" | "stop" | "succeed";
  readonly text: string | null;
}

interface ResolvedScanCompletion {
  readonly deadCodeFailure: AnalysisFailureState;
  readonly shouldComputeScore: boolean;
  readonly progress: ScanProgressCompletion;
}

const DEAD_CODE_FAIL_TEXT = "Scanning failed (dead-code analysis, non-fatal).";

export const resolveScanCompletion = (
  input: ResolveScanCompletionInput,
): ResolvedScanCompletion => {
  const deadCodeFailure = input.lintDidFail
    ? { didFail: false, reason: null }
    : input.deadCodeFailure;

  if (input.lintDidFail) {
    return {
      deadCodeFailure,
      shouldComputeScore: false,
      progress: { action: "unchanged", text: null },
    };
  }

  if (deadCodeFailure.didFail) {
    return {
      deadCodeFailure,
      shouldComputeScore: false,
      progress: { action: "fail", text: DEAD_CODE_FAIL_TEXT },
    };
  }

  if (input.suppressScanSummary) {
    return {
      deadCodeFailure,
      shouldComputeScore: true,
      progress: { action: "stop", text: null },
    };
  }

  const scanElapsedSeconds = (input.scanElapsedMilliseconds / MILLISECONDS_PER_SECOND).toFixed(1);

  return {
    deadCodeFailure,
    shouldComputeScore: true,
    progress: {
      action: "succeed",
      text: `Scanned ${input.scannedFilesLabel} in ${scanElapsedSeconds}s${input.workerCountSuffix}`,
    },
  };
};
