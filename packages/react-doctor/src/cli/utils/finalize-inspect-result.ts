import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import {
  buildSkippedChecks,
  type Diagnostic,
  filterDiagnosticsForSurface,
  highlighter,
  type InspectResult,
  type ReactDoctorConfig,
  type ScoreResult,
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

interface FinalizeInspectResultInput {
  readonly options: ResolvedInspectOptions;
  readonly elapsedMilliseconds: number;
  readonly diagnostics: ReadonlyArray<Diagnostic>;
  readonly score: ScoreResult | null;
  readonly project: InspectResult["project"];
  readonly userConfig: ReactDoctorConfig | null;
  readonly didLintFail: boolean;
  readonly lintFailureReason: string | null;
  readonly lintPartialFailures: ReadonlyArray<string>;
  readonly didDeadCodeFail: boolean;
  readonly deadCodeFailureReason: string | null;
  readonly supplyChainOverlapTimedOut: boolean;
  readonly securityScanFailed: boolean;
  readonly securityScanFailureReason: string | null;
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

export const finalizeInspectResult = (
  input: FinalizeInspectResultInput,
): Effect.Effect<InspectResult> =>
  Effect.gen(function* () {
    const { skippedChecks, skippedCheckReasons } = buildSkippedChecks({
      didLintFail: input.didLintFail,
      lintFailureReason: input.lintFailureReason,
      lintPartialFailures: input.lintPartialFailures,
      didDeadCodeFail: input.didDeadCodeFail,
      deadCodeFailureReason: input.deadCodeFailureReason,
      supplyChainOverlapTimedOut: input.supplyChainOverlapTimedOut,
      securityScanFailed: input.securityScanFailed,
      securityScanFailureReason: input.securityScanFailureReason,
    });
    const hasSkippedChecks = skippedChecks.length > 0;
    const noScoreMessage = buildNoScoreMessage({
      isScoreDisabled: input.options.noScore,
      isAnalysisIncomplete: hasIncompleteScoreAnalysis(skippedChecks),
      disabledMessage: input.options.scoreDisabledMessage,
    });
    const result: InspectResult = {
      diagnostics: [...input.diagnostics],
      score: input.score,
      skippedChecks,
      ...(Object.keys(skippedCheckReasons).length > 0 ? { skippedCheckReasons } : {}),
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
    };

    if (input.options.suppressRendering) return result;

    const surfaceDiagnostics = filterDiagnosticsForSurface(
      [...input.diagnostics],
      input.options.outputSurface,
      input.userConfig,
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
      if (input.score) {
        yield* Console.log(`${input.score.score}`);
      } else {
        yield* Console.error(highlighter.gray(noScoreMessage));
      }
      return result;
    }

    const demotedDiagnosticCount = input.diagnostics.length - surfaceDiagnostics.length;
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
      projectName: input.project.projectName,
      scannedFileCount: input.scannedFileCount,
      scoreResult: hasSkippedChecks ? null : input.score,
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
      scoreResult: input.score,
      projectName: input.project.projectName,
      isOffline: input.options.isCi || !input.options.share || input.score === null,
    });

    return result;
  });
