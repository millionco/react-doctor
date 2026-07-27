import type { ScoreRequestMetadata } from "./calculate-score.js";
import type { OxlintUnavailable, ReactDoctorErrorReason } from "./errors.js";
import type {
  Diagnostic,
  ProjectInfo,
  ReactDoctorConfig,
  ScoreResult,
  SuppressedRuleCount,
} from "./types/index.js";

export interface InspectOutput {
  readonly project: ProjectInfo;
  readonly userConfig: ReactDoctorConfig | null;
  readonly resolvedDirectory: string;
  readonly diagnostics: ReadonlyArray<Diagnostic>;
  readonly score: ScoreResult | null;
  readonly scoreMetadata: ScoreRequestMetadata;
  readonly didLintFail: boolean;
  readonly lintFailureReason: string | null;
  /**
   * The `_tag` of `error.reason` when the lint stream raised a
   * `ReactDoctorError`, or `null` otherwise.
   */
  readonly lintFailureReasonTag: ReactDoctorErrorReason["_tag"] | null;
  /**
   * The `kind` of an `OxlintUnavailable` lint failure, or `null` for any
   * other failure.
   */
  readonly lintFailureReasonKind: OxlintUnavailable["kind"] | null;
  readonly lintPartialFailures: ReadonlyArray<string>;
  /** `false` when dead-code analysis was disabled, skipped, or discarded. */
  readonly didDeadCodeFail: boolean;
  readonly deadCodeFailureReason: string | null;
  /** Whether dead-code analysis ran concurrently with lint for this scan. */
  readonly deadCodeOverlapped: boolean;
  /** Number of files reported by the scan. */
  readonly scannedFileCount: number;
  /** Absolute paths considered by scans that request a multi-project summary. */
  readonly scannedFilePaths: ReadonlyArray<string>;
  /** Project-relative POSIX paths the lint pass completed successfully. */
  readonly analyzedFiles: ReadonlyArray<string>;
  /** Wall-clock duration of the scan phase, in milliseconds. */
  readonly scanElapsedMilliseconds: number;
  /** Resolved lint worker count used by the linter. */
  readonly scanConcurrency: number;
  /** Whether the supply-chain pass failed open after exceeding its overlap budget. */
  readonly supplyChainOverlapTimedOut: boolean;
  /** Whether the security scan failed open after a filesystem error. */
  readonly securityScanFailed: boolean;
  /** Per-file lint cache outcomes, or `null` when the cache was not consulted. */
  readonly lintCacheHitFileCount: number | null;
  readonly lintCacheTotalFileCount: number | null;
  /** Sidecar replay outcomes, or `null` when the sidecar was not consulted. */
  readonly lintSidecarReplayedFileCount: number | null;
  readonly lintSidecarTotalFileCount: number | null;
  /** Whole-result dead-code cache outcome, or `null` when it was not consulted. */
  readonly deadCodeCacheHit: boolean | null;
  /** Incremental dead-code summary-cache outcomes, or `null` when unavailable. */
  readonly deadCodeSummaryCacheHits: number | null;
  readonly deadCodeSummaryCacheMisses: number | null;
  /** Per-rule tallies of diagnostics explicitly suppressed by the user. */
  readonly suppressedRuleCounts: ReadonlyArray<SuppressedRuleCount>;
}

export interface InspectLintCompletion {
  readonly didFail: boolean;
  readonly failureReason: string | null;
  readonly failureReasonTag: ReactDoctorErrorReason["_tag"] | null;
  readonly failureReasonKind: OxlintUnavailable["kind"] | null;
  readonly partialFailures: ReadonlyArray<string>;
  readonly analyzedFiles: ReadonlyArray<string>;
  readonly cacheHitFileCount: number | null;
  readonly cacheTotalFileCount: number | null;
  readonly sidecarReplayedFileCount: number | null;
  readonly sidecarTotalFileCount: number | null;
}

export interface InspectDeadCodeCompletion {
  readonly didFail: boolean;
  readonly failureReason: string | null;
  readonly didOverlap: boolean;
  readonly cacheHit: boolean | null;
  readonly summaryCacheHits: number | null;
  readonly summaryCacheMisses: number | null;
}

export interface InspectScanCompletion {
  readonly scannedFileCount: number;
  readonly scannedFilePaths: ReadonlyArray<string>;
  readonly elapsedMilliseconds: number;
  readonly concurrency: number;
}

export interface AssembleInspectOutputInput {
  readonly project: ProjectInfo;
  readonly userConfig: ReactDoctorConfig | null;
  readonly resolvedDirectory: string;
  readonly diagnostics: ReadonlyArray<Diagnostic>;
  readonly score: ScoreResult | null;
  readonly scoreMetadata: ScoreRequestMetadata;
  readonly lint: InspectLintCompletion;
  readonly deadCode: InspectDeadCodeCompletion;
  readonly scan: InspectScanCompletion;
  readonly supplyChainOverlapTimedOut: boolean;
  readonly securityScanFailed: boolean;
  readonly suppressedRuleCounts: ReadonlyArray<SuppressedRuleCount>;
}

export const assembleInspectOutput = (input: AssembleInspectOutputInput): InspectOutput => ({
  project: input.project,
  userConfig: input.userConfig,
  resolvedDirectory: input.resolvedDirectory,
  diagnostics: input.diagnostics,
  score: input.score,
  scoreMetadata: input.scoreMetadata,
  didLintFail: input.lint.didFail,
  lintFailureReason: input.lint.failureReason,
  lintFailureReasonTag: input.lint.failureReasonTag,
  lintFailureReasonKind: input.lint.failureReasonKind,
  lintPartialFailures: input.lint.partialFailures,
  didDeadCodeFail: input.deadCode.didFail,
  deadCodeFailureReason: input.deadCode.failureReason,
  deadCodeOverlapped: input.deadCode.didOverlap,
  scannedFileCount: input.scan.scannedFileCount,
  scannedFilePaths: input.scan.scannedFilePaths,
  analyzedFiles: input.lint.analyzedFiles,
  scanElapsedMilliseconds: input.scan.elapsedMilliseconds,
  scanConcurrency: input.scan.concurrency,
  supplyChainOverlapTimedOut: input.supplyChainOverlapTimedOut,
  securityScanFailed: input.securityScanFailed,
  lintCacheHitFileCount: input.lint.cacheHitFileCount,
  lintCacheTotalFileCount: input.lint.cacheTotalFileCount,
  lintSidecarReplayedFileCount: input.lint.sidecarReplayedFileCount,
  lintSidecarTotalFileCount: input.lint.sidecarTotalFileCount,
  deadCodeCacheHit: input.lint.didFail ? null : input.deadCode.cacheHit,
  deadCodeSummaryCacheHits: input.lint.didFail ? null : input.deadCode.summaryCacheHits,
  deadCodeSummaryCacheMisses: input.lint.didFail ? null : input.deadCode.summaryCacheMisses,
  suppressedRuleCounts: input.suppressedRuleCounts,
});
