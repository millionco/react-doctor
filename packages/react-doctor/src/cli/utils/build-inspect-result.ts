import type { Diagnostic, InspectResult, ProjectInfo, ScoreResult } from "../../core/core-types.js";

export interface BuildInspectResultInput {
  readonly diagnostics: ReadonlyArray<Diagnostic>;
  readonly score: ScoreResult | null;
  readonly skippedChecks: string[];
  readonly skippedCheckReasons: Record<string, string>;
  readonly project: ProjectInfo;
  readonly elapsedMilliseconds: number;
  readonly scannedFileCount: number;
  readonly scannedFilePaths: ReadonlyArray<string>;
  readonly analyzedFiles: ReadonlyArray<string>;
  readonly scanElapsedMilliseconds: number;
  readonly lintCacheHitFileCount: number | null;
  readonly lintCacheTotalFileCount: number | null;
  readonly lintSidecarReplayedFileCount: number | null;
  readonly lintSidecarTotalFileCount: number | null;
  readonly deadCodeCacheHit: boolean | null;
  readonly deadCodeSummaryCacheHits: number | null;
  readonly deadCodeSummaryCacheMisses: number | null;
  readonly baselineDelta: InspectResult["baselineDelta"];
}

export const buildInspectResult = (input: BuildInspectResultInput): InspectResult => ({
  diagnostics: [...input.diagnostics],
  score: input.score,
  skippedChecks: input.skippedChecks,
  ...(Object.keys(input.skippedCheckReasons).length > 0
    ? { skippedCheckReasons: input.skippedCheckReasons }
    : {}),
  project: input.project,
  elapsedMilliseconds: input.elapsedMilliseconds,
  scannedFileCount: input.scannedFileCount,
  scannedFilePaths: input.scannedFilePaths,
  analyzedFiles: input.analyzedFiles,
  scanElapsedMilliseconds: input.scanElapsedMilliseconds,
  ...(input.lintCacheTotalFileCount !== null
    ? {
        lintCacheHitFileCount: input.lintCacheHitFileCount,
        lintCacheTotalFileCount: input.lintCacheTotalFileCount,
      }
    : {}),
  ...(input.lintSidecarTotalFileCount !== null
    ? {
        lintSidecarReplayedFileCount: input.lintSidecarReplayedFileCount,
        lintSidecarTotalFileCount: input.lintSidecarTotalFileCount,
      }
    : {}),
  ...(input.deadCodeCacheHit !== null ? { deadCodeCacheHit: input.deadCodeCacheHit } : {}),
  ...(input.deadCodeSummaryCacheHits !== null && input.deadCodeSummaryCacheMisses !== null
    ? {
        deadCodeSummaryCacheHits: input.deadCodeSummaryCacheHits,
        deadCodeSummaryCacheMisses: input.deadCodeSummaryCacheMisses,
      }
    : {}),
  ...(input.baselineDelta ? { baselineDelta: input.baselineDelta } : {}),
});
