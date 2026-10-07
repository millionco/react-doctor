import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import {
  type Diagnostic,
  filterDiagnosticsForSurface,
  highlighter,
  type InspectResult,
} from "@react-doctor/core";
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

interface InspectPresentation {
  readonly diagnostics: Diagnostic[];
  readonly demotedDiagnosticCount: number;
}

interface PrintScoreOnlyInspectResultInput {
  readonly options: ResolvedInspectOptions;
  readonly payload: CachedScanPayload;
  readonly diagnostics: Diagnostic[];
  readonly noScoreMessage: string;
}

interface PrintFullInspectResultInput extends FinalizeInspectResultInput, InspectPresentation {
  readonly result: InspectResult;
  readonly noScoreMessage: string;
}

interface PrintFullInspectResultDetailsInput extends InspectPresentation {
  readonly options: ResolvedInspectOptions;
  readonly payload: CachedScanPayload;
}

const buildInspectPresentation = ({
  options,
  payload,
}: FinalizeInspectResultInput): InspectPresentation => {
  const surfaceDiagnostics = filterDiagnosticsForSurface(
    [...payload.diagnostics],
    options.outputSurface,
    payload.userConfig,
  );
  return {
    diagnostics: filterDiagnosticsByCategories(surfaceDiagnostics, options.categoryFilters),
    demotedDiagnosticCount: payload.diagnostics.length - surfaceDiagnostics.length,
  };
};

const printScoreOnlyInspectResult = ({
  options,
  payload,
  diagnostics,
  noScoreMessage,
}: PrintScoreOnlyInspectResultInput): Effect.Effect<void> =>
  Effect.gen(function* () {
    if (options.outputDirectory !== null) {
      yield* printDiagnosticsDump(diagnostics, options.outputDirectory, false, "stderr");
    }
    if (payload.score) {
      yield* Console.log(`${payload.score.score}`);
      return;
    }
    yield* Console.error(highlighter.gray(noScoreMessage));
  });

const printFullInspectResultDetails = ({
  options,
  payload,
  diagnostics,
  demotedDiagnosticCount,
}: PrintFullInspectResultDetailsInput): Effect.Effect<void> =>
  Effect.gen(function* () {
    if (options.outputDirectory !== null || options.verbose) {
      yield* printDiagnosticsDump(diagnostics, options.outputDirectory, options.verbose);
    }
    if (options.categoryFilters.size === 0 && demotedDiagnosticCount > 0) {
      yield* Console.log(
        highlighter.gray(
          `  ${demotedDiagnosticCount} demoted from the ${options.outputSurface} surface (e.g. design cleanup) — run \`npx react-doctor@latest .\` locally for the full list.`,
        ),
      );
      yield* Console.log("");
    }
    yield* printFooter({
      diagnostics,
      scoreResult: payload.score,
      projectName: payload.project.projectName,
      isOffline: options.isCi || !options.share || payload.score === null,
    });
  });

const printFullInspectResult = ({
  options,
  elapsedMilliseconds,
  payload,
  result,
  diagnostics,
  demotedDiagnosticCount,
  noScoreMessage,
}: PrintFullInspectResultInput): Effect.Effect<void> =>
  Effect.gen(function* () {
    if (options.isNonInteractiveEnvironment && options.outputSurface !== "prComment") {
      yield* printAgentGuidance();
    }

    yield* printHeadlessReport({
      diagnostics,
      elapsedMilliseconds,
      emptyStateMessage: buildEmptyReportMessage({
        categoryFilters: options.categoryFilters,
        demotedDiagnosticCount,
        outputSurface: options.outputSurface,
      }),
      noScoreMessage,
      projectName: payload.project.projectName,
      scannedFileCount: payload.scannedFileCount,
      scoreResult: result.skippedChecks.length > 0 ? null : payload.score,
      skippedChecks: result.skippedChecks,
    });

    yield* printFullInspectResultDetails({
      options,
      payload,
      diagnostics,
      demotedDiagnosticCount,
    });
  });

export const finalizeInspectResult = (
  input: FinalizeInspectResultInput,
): Effect.Effect<InspectResult> =>
  Effect.gen(function* () {
    const { payload } = input;
    const result = buildInspectResult(input);
    const noScoreMessage = buildNoScoreMessage({
      isScoreDisabled: input.options.noScore,
      isAnalysisIncomplete: hasIncompleteScoreAnalysis(result.skippedChecks),
      disabledMessage: input.options.scoreDisabledMessage,
    });

    if (input.options.suppressRendering) return result;

    const presentation = buildInspectPresentation(input);

    if (input.options.scoreOnly) {
      yield* printScoreOnlyInspectResult({
        options: input.options,
        payload,
        diagnostics: presentation.diagnostics,
        noScoreMessage,
      });
      return result;
    }

    yield* printFullInspectResult({
      ...input,
      ...presentation,
      result,
      noScoreMessage,
    });

    return result;
  });
