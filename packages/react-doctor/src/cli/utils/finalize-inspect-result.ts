import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import {
  buildSkippedChecks,
  filterDiagnosticsForSurface,
  highlighter,
  type InspectResult,
} from "@react-doctor/core";
import type { ResolvedInspectOptions } from "../../inspect-options.js";
import { buildEmptyReportMessage } from "./build-empty-report-message.js";
import { buildNoScoreMessage } from "./build-no-score-message.js";
import { filterDiagnosticsByCategories } from "./filter-diagnostics-by-categories.js";
import { hasIncompleteScoreAnalysis } from "./has-incomplete-score-analysis.js";
import { printDiagnosticsDump } from "./print-diagnostics-dump.js";
import { printFooter } from "./print-footer.js";
import { printHeadlessReport } from "./print-headless-report.js";
import { printAgentGuidance } from "./render-agent-guidance.js";
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

interface FinalizeInspectResultInput {
  readonly options: ResolvedInspectOptions;
  readonly elapsedMilliseconds: number;
  readonly payload: CachedScanPayload;
  readonly cacheStats: InspectExecutionCacheStats;
}

export const finalizeInspectResult = (
  input: FinalizeInspectResultInput,
): Effect.Effect<InspectResult> =>
  Effect.gen(function* () {
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
    const hasSkippedChecks = skippedChecks.length > 0;
    const noScoreMessage = buildNoScoreMessage({
      isScoreDisabled: input.options.noScore,
      isAnalysisIncomplete: hasIncompleteScoreAnalysis(skippedChecks),
      disabledMessage: input.options.scoreDisabledMessage,
    });
    const result: InspectResult = {
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
      ...(cacheStats.lintCacheTotalFileCount !== null
        ? {
            lintCacheHitFileCount: cacheStats.lintCacheHitFileCount,
            lintCacheTotalFileCount: cacheStats.lintCacheTotalFileCount,
          }
        : {}),
      ...(cacheStats.lintSidecarTotalFileCount !== null
        ? {
            lintSidecarReplayedFileCount: cacheStats.lintSidecarReplayedFileCount,
            lintSidecarTotalFileCount: cacheStats.lintSidecarTotalFileCount,
          }
        : {}),
      ...(cacheStats.deadCodeCacheHit !== null
        ? { deadCodeCacheHit: cacheStats.deadCodeCacheHit }
        : {}),
      ...(cacheStats.deadCodeSummaryCacheHits !== null &&
      cacheStats.deadCodeSummaryCacheMisses !== null
        ? {
            deadCodeSummaryCacheHits: cacheStats.deadCodeSummaryCacheHits,
            deadCodeSummaryCacheMisses: cacheStats.deadCodeSummaryCacheMisses,
          }
        : {}),
      ...(payload.baselineDelta ? { baselineDelta: payload.baselineDelta } : {}),
    };

    if (input.options.suppressRendering) return result;

    const surfaceDiagnostics = filterDiagnosticsForSurface(
      [...payload.diagnostics],
      input.options.outputSurface,
      payload.userConfig,
    );
    const printedDiagnostics = filterDiagnosticsByCategories(
      surfaceDiagnostics,
      input.options.categoryFilters,
    );

    if (input.options.scoreOnly) {
      if (input.options.outputDirectory !== null) {
        yield* printDiagnosticsDump(
          printedDiagnostics,
          input.options.outputDirectory,
          false,
          "stderr",
        );
      }
      if (payload.score) {
        yield* Console.log(`${payload.score.score}`);
      } else {
        yield* Console.error(highlighter.gray(noScoreMessage));
      }
      return result;
    }

    const demotedDiagnosticCount = payload.diagnostics.length - surfaceDiagnostics.length;
    if (input.options.isNonInteractiveEnvironment && input.options.outputSurface !== "prComment") {
      yield* printAgentGuidance();
    }

    yield* printHeadlessReport({
      diagnostics: printedDiagnostics,
      elapsedMilliseconds: input.elapsedMilliseconds,
      emptyStateMessage: buildEmptyReportMessage({
        categoryFilters: input.options.categoryFilters,
        demotedDiagnosticCount,
        outputSurface: input.options.outputSurface,
      }),
      noScoreMessage,
      projectName: payload.project.projectName,
      scannedFileCount: payload.scannedFileCount,
      scoreResult: hasSkippedChecks ? null : payload.score,
      skippedChecks,
    });

    if (input.options.outputDirectory !== null || input.options.verbose) {
      yield* printDiagnosticsDump(
        printedDiagnostics,
        input.options.outputDirectory,
        input.options.verbose,
      );
    }
    if (input.options.categoryFilters.size === 0 && demotedDiagnosticCount > 0) {
      yield* Console.log(
        highlighter.gray(
          `  ${demotedDiagnosticCount} demoted from the ${input.options.outputSurface} surface (e.g. design cleanup) — run \`npx react-doctor@latest .\` locally for the full list.`,
        ),
      );
      yield* Console.log("");
    }

    yield* printFooter({
      diagnostics: printedDiagnostics,
      scoreResult: payload.score,
      projectName: payload.project.projectName,
      isOffline: input.options.isCi || !input.options.share || payload.score === null,
    });

    return result;
  });
