import { buildSkippedChecks, type InspectResult } from "@react-doctor/core";
import type { CachedScanPayload } from "./scan-result-cache-payload.js";

export interface InspectExecutionCacheStats {
  readonly lintCacheHitFileCount: number | null;
  readonly lintCacheTotalFileCount: number | null;
  readonly lintSidecarReplayedFileCount: number | null;
  readonly lintSidecarTotalFileCount: number | null;
  readonly deadCodeCacheHit: boolean | null;
  readonly deadCodeSummaryCacheHits: number | null;
  readonly deadCodeSummaryCacheMisses: number | null;
}

interface BuildInspectResultInput {
  readonly payload: CachedScanPayload;
  readonly cacheStats: InspectExecutionCacheStats;
  readonly elapsedMilliseconds: number;
}

export const buildInspectResult = (input: BuildInspectResultInput): InspectResult => {
  const { payload, cacheStats } = input;
  const { skippedChecks, skippedCheckReasons } = buildSkippedChecks({
    didLintFail: payload.didLintFail,
    lintFailureReason: payload.lintFailureReason,
    lintPartialFailures: payload.lintPartialFailures,
    didDeadCodeFail: payload.didDeadCodeFail,
    deadCodeFailureReason: payload.deadCodeFailureReason,
    supplyChainOverlapTimedOut: payload.supplyChainOverlapTimedOut,
    securityScanFailed: payload.securityScanFailed ?? false,
    securityScanFailureReason: payload.securityScanFailureReason ?? null,
  });

  return {
    diagnostics: [...payload.diagnostics],
    score: payload.score,
    skippedChecks,
    ...(Object.keys(skippedCheckReasons).length > 0 ? { skippedCheckReasons } : {}),
    project: payload.project,
    elapsedMilliseconds: input.elapsedMilliseconds,
    scannedFileCount: payload.scannedFileCount,
    scannedFilePaths: payload.scannedFilePaths,
    analyzedFiles: payload.analyzedFiles ?? [],
    scanElapsedMilliseconds: payload.scanElapsedMilliseconds,
    ...(cacheStats.lintCacheTotalFileCount === null
      ? {}
      : {
          lintCacheHitFileCount: cacheStats.lintCacheHitFileCount,
          lintCacheTotalFileCount: cacheStats.lintCacheTotalFileCount,
        }),
    ...(cacheStats.lintSidecarTotalFileCount === null
      ? {}
      : {
          lintSidecarReplayedFileCount: cacheStats.lintSidecarReplayedFileCount,
          lintSidecarTotalFileCount: cacheStats.lintSidecarTotalFileCount,
        }),
    ...(cacheStats.deadCodeCacheHit === null
      ? {}
      : { deadCodeCacheHit: cacheStats.deadCodeCacheHit }),
    ...(cacheStats.deadCodeSummaryCacheHits === null ||
    cacheStats.deadCodeSummaryCacheMisses === null
      ? {}
      : {
          deadCodeSummaryCacheHits: cacheStats.deadCodeSummaryCacheHits,
          deadCodeSummaryCacheMisses: cacheStats.deadCodeSummaryCacheMisses,
        }),
    ...(payload.baselineDelta ? { baselineDelta: payload.baselineDelta } : {}),
  };
};
