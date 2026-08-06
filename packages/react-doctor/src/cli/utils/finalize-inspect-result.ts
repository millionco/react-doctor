import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import { filterDiagnosticsForSurface, highlighter, type InspectResult } from "@react-doctor/core";
import type { ResolvedInspectOptions } from "../../inspect-options.js";
import { buildEmptyReportMessage } from "./build-empty-report-message.js";
import { buildInspectResult, type InspectExecutionCacheStats } from "./build-inspect-result.js";
import { buildNoScoreMessage } from "./build-no-score-message.js";
import { filterDiagnosticsByCategories } from "./filter-diagnostics-by-categories.js";
import { hasIncompleteScoreAnalysis } from "./has-incomplete-score-analysis.js";
import { printDiagnosticsDump } from "./print-diagnostics-dump.js";
import { printFooter } from "./print-footer.js";
import { printHeadlessReport } from "./print-headless-report.js";
import { printAgentGuidance } from "./render-agent-guidance.js";
import type { CachedScanPayload } from "./scan-result-cache-payload.js";

export type { InspectExecutionCacheStats } from "./build-inspect-result.js";

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
    const { payload } = input;
    const result = buildInspectResult(input);
    const hasSkippedChecks = result.skippedChecks.length > 0;
    const noScoreMessage = buildNoScoreMessage({
      isScoreDisabled: input.options.noScore,
      isAnalysisIncomplete: hasIncompleteScoreAnalysis(result.skippedChecks),
      disabledMessage: input.options.scoreDisabledMessage,
    });

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
      skippedChecks: result.skippedChecks,
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
