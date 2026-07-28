import { performance } from "node:perf_hooks";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import type { ReactDoctorConfig } from "../../core/core-configuration.js";
import { filterDiagnosticsForSurface } from "../../core/core-diagnostic-semantics.js";
import { highlighter } from "../../core/core-presentation.js";
import { buildSkippedChecks } from "../../core/core-reporting.js";
import type { Diagnostic, InspectResult, ScoreResult } from "../../core/core-types.js";
import type { ResolvedInspectOptions } from "../../inspect-options.js";
import { buildInspectResult } from "./build-inspect-result.js";
import { buildNoScoreMessage } from "./build-no-score-message.js";
import { recordRunEvent } from "./build-run-event.js";
import { computeProjectedScore } from "./compute-score-projection.js";
import { countDeadlineSkippedFiles } from "./count-deadline-skipped-files.js";
import { countDroppedLintFiles } from "./count-dropped-lint-files.js";
import { buildRulePriorityMap } from "./diagnostic-grouping.js";
import { filterDiagnosticsByCategories } from "./filter-diagnostics-by-categories.js";
import { isCodingAgentEnvironment } from "./is-ci-environment.js";
import { makeNoopConsole } from "./noop-console.js";
import { canAnimateOnboarding, onboardingSectionPause } from "./onboarding-pacing.js";
import { recordScanMetrics } from "./record-scan-metrics.js";
import { printAgentGuidance } from "./render-agent-guidance.js";
import { printDiagnostics } from "./render-diagnostics.js";
import { printProjectDetection } from "./render-project-detection.js";
import {
  printBrandingOnlyHeader,
  printNoScoreHeader,
  printScoreHeader,
} from "./render-score-header.js";
import { printDiagnosticsDump, printFooter, printSummary } from "./render-summary.js";
import type { CachedScanPayload } from "./scan-result-cache.js";
import { resolveWorkerTelemetry } from "./resolve-worker-telemetry.js";
import { shouldRenderHyperlinks } from "./should-render-hyperlinks.js";
import { shouldShowShareLink } from "./should-show-share-link.js";
import type { SentryRootSpan } from "./with-sentry-run-span.js";

interface FinalizeInput {
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
  readonly directory: string;
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

export interface RenderCachedProjectDetectionInput {
  readonly payload: CachedScanPayload;
  readonly options: ResolvedInspectOptions;
  readonly userConfig: ReactDoctorConfig | null;
  readonly isDiffMode: boolean;
}

export interface RenderAndRecordScanInput {
  readonly payload: CachedScanPayload;
  readonly options: ResolvedInspectOptions;
  readonly userConfig: ReactDoctorConfig | null;
  readonly hasCustomConfig: boolean;
  readonly startTime: number;
  readonly rootSentrySpan: SentryRootSpan;
  readonly scanMode: "full" | "diff" | "baseline";
  readonly baselineDegraded: boolean;
  readonly wholeRepoCacheHit: boolean;
  readonly lintCacheHitFileCount?: number | null;
  readonly lintCacheTotalFileCount?: number | null;
  readonly lintSidecarReplayedFileCount?: number | null;
  readonly lintSidecarTotalFileCount?: number | null;
  readonly deadCodeCacheHit?: boolean | null;
  readonly deadCodeSummaryCacheHits?: number | null;
  readonly deadCodeSummaryCacheMisses?: number | null;
}

const formatCategorySelection = (categoryFilters: ReadonlySet<string>): string =>
  [...categoryFilters].join(", ");

const deriveScope = (options: ResolvedInspectOptions): string => {
  if (options.baseline) return "changed";
  if (options.changedLineRanges !== null) return "lines";
  return options.includePaths.length > 0 ? "files" : "full";
};

export const buildRunEventConfig = (
  options: ResolvedInspectOptions,
  userConfig: ReactDoctorConfig | null,
  hasCustomConfig: boolean,
  resolvedWorkerCount?: number,
) => {
  const { workerCount, parallel } = resolveWorkerTelemetry(
    resolvedWorkerCount,
    options.concurrency,
  );
  return {
    scope: deriveScope(options),
    parallel,
    workerCount,
    maxDurationMs: options.maxDurationMs,
    lint: options.lint,
    deadCode: options.deadCode,
    supplyChain: options.supplyChain,
    scoreOnly: options.scoreOnly,
    noScore: options.noScore,
    respectInlineDisables: options.respectInlineDisables,
    showWarnings: options.warnings,
    usedOutputDir: options.outputDirectory !== null,
    ignoredTagCount: options.ignoredTags.size,
    hasCustomConfig,
    userConfig,
  };
};

export const silentConsole = makeNoopConsole();

const runMaybeSilent = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  silent: boolean,
): Effect.Effect<A, E, R> =>
  silent ? effect.pipe(Effect.provideService(Console.Console, silentConsole)) : effect;

export const renderCachedProjectDetection = async (
  input: RenderCachedProjectDetectionInput,
): Promise<void> => {
  if (input.options.scoreOnly || input.options.suppressRendering) return;
  await Effect.runPromise(
    runMaybeSilent(
      printProjectDetection({
        projectInfo: input.payload.project,
        userConfig: input.userConfig,
        isDiffMode: input.isDiffMode,
        includePaths: input.options.includePaths,
        lintSourceFileCount: input.payload.scannedFileCount,
      }),
      input.options.silent,
    ),
  );
};

export const renderAndRecordScan = async (
  input: RenderAndRecordScanInput,
): Promise<InspectResult> => {
  const finalizeInput: FinalizeInput = {
    options: input.options,
    elapsedMilliseconds: performance.now() - input.startTime,
    diagnostics: input.payload.diagnostics,
    score: input.payload.score,
    project: input.payload.project,
    userConfig: input.payload.userConfig,
    didLintFail: input.payload.didLintFail,
    lintFailureReason: input.payload.lintFailureReason,
    lintPartialFailures: input.payload.lintPartialFailures,
    didDeadCodeFail: input.payload.didDeadCodeFail,
    deadCodeFailureReason: input.payload.deadCodeFailureReason,
    supplyChainOverlapTimedOut: input.payload.supplyChainOverlapTimedOut,
    securityScanFailed: input.payload.securityScanFailed ?? false,
    directory: input.payload.directory,
    scannedFileCount: input.payload.scannedFileCount,
    scannedFilePaths: input.payload.scannedFilePaths,
    analyzedFiles: input.payload.analyzedFiles ?? [],
    scanElapsedMilliseconds: input.payload.scanElapsedMilliseconds,
    lintCacheHitFileCount: input.lintCacheHitFileCount ?? null,
    lintCacheTotalFileCount: input.lintCacheTotalFileCount ?? null,
    lintSidecarReplayedFileCount: input.lintSidecarReplayedFileCount ?? null,
    lintSidecarTotalFileCount: input.lintSidecarTotalFileCount ?? null,
    deadCodeCacheHit: input.deadCodeCacheHit ?? null,
    deadCodeSummaryCacheHits: input.deadCodeSummaryCacheHits ?? null,
    deadCodeSummaryCacheMisses: input.deadCodeSummaryCacheMisses ?? null,
    baselineDelta: input.payload.baselineDelta,
  };
  const result = await Effect.runPromise(
    runMaybeSilent(finalizeAndRender(finalizeInput), input.options.silent),
  );
  const { workerCount: resolvedWorkerCount, parallel } = resolveWorkerTelemetry(
    input.payload.scanConcurrency,
    input.options.concurrency,
  );
  recordScanMetrics({
    result,
    mode: input.scanMode,
    baselineDegraded: input.baselineDegraded,
    parallel,
    workerCount: resolvedWorkerCount,
    lint: input.options.lint,
    deadCode: input.options.deadCode,
    scoreOnly: input.options.scoreOnly,
    noScore: input.options.noScore,
    didLintFail: input.payload.didLintFail,
    lintFailureReasonKind: input.payload.lintFailureReasonKind,
    didDeadCodeFail: input.payload.didDeadCodeFail,
    userConfig: input.userConfig,
    suppressedRuleCounts: input.payload.suppressedRuleCounts,
  });
  recordRunEvent(input.rootSentrySpan, {
    ...buildRunEventConfig(
      input.options,
      input.userConfig,
      input.hasCustomConfig,
      resolvedWorkerCount,
    ),
    result,
    mode: input.scanMode,
    gateExempt: input.baselineDegraded,
    wholeRepoCacheHit: input.wholeRepoCacheHit,
    didLintFail: input.payload.didLintFail,
    lintFailureReasonKind: input.payload.lintFailureReasonKind,
    lintPartialFailureCount: input.payload.lintPartialFailures.length,
    lintDroppedFileCount: countDroppedLintFiles(input.payload.lintPartialFailures),
    lintDeadlineSkippedFileCount: countDeadlineSkippedFiles(input.payload.lintPartialFailures),
    didDeadCodeFail: input.payload.didDeadCodeFail,
    supplyChainOverlapTimedOut: input.payload.supplyChainOverlapTimedOut,
    securityScanFailed: input.payload.securityScanFailed,
    deadCodeOverlapped: input.payload.deadCodeOverlapped,
    suppressedRuleCounts: input.payload.suppressedRuleCounts,
  });
  return result;
};

const finalizeAndRender = (input: FinalizeInput): Effect.Effect<InspectResult> =>
  Effect.gen(function* () {
    const {
      options,
      elapsedMilliseconds,
      diagnostics,
      score,
      project,
      userConfig,
      didLintFail,
      lintFailureReason,
      lintPartialFailures,
      didDeadCodeFail,
      deadCodeFailureReason,
      supplyChainOverlapTimedOut,
      securityScanFailed,
      directory,
      scannedFileCount,
      scannedFilePaths,
      analyzedFiles,
      scanElapsedMilliseconds,
      lintCacheHitFileCount,
      lintCacheTotalFileCount,
      lintSidecarReplayedFileCount,
      lintSidecarTotalFileCount,
      deadCodeCacheHit,
      deadCodeSummaryCacheHits,
      deadCodeSummaryCacheMisses,
      baselineDelta,
    } = input;

    const { skippedChecks, skippedCheckReasons } = buildSkippedChecks({
      didLintFail,
      lintFailureReason,
      lintPartialFailures,
      didDeadCodeFail,
      deadCodeFailureReason,
      supplyChainOverlapTimedOut,
      securityScanFailed,
    });
    const hasSkippedChecks = skippedChecks.length > 0;
    const noScoreMessage = buildNoScoreMessage(options.noScore, options.scoreDisabledMessage);

    const buildResult = (): InspectResult =>
      buildInspectResult({
        diagnostics,
        score,
        skippedChecks,
        skippedCheckReasons,
        project,
        elapsedMilliseconds,
        scannedFileCount,
        scannedFilePaths,
        analyzedFiles,
        scanElapsedMilliseconds,
        lintCacheHitFileCount,
        lintCacheTotalFileCount,
        lintSidecarReplayedFileCount,
        lintSidecarTotalFileCount,
        deadCodeCacheHit,
        deadCodeSummaryCacheHits,
        deadCodeSummaryCacheMisses,
        baselineDelta,
      });

    if (options.suppressRendering) return buildResult();

    const surfaceDiagnostics = filterDiagnosticsForSurface(
      [...diagnostics],
      options.outputSurface,
      userConfig,
    );
    const printedDiagnostics = filterDiagnosticsByCategories(
      surfaceDiagnostics,
      options.categoryFilters,
    );

    if (options.scoreOnly) {
      if (options.outputDirectory !== null) {
        yield* printDiagnosticsDump(printedDiagnostics, options.outputDirectory, false, "stderr");
      }
      if (score) yield* Console.log(`${score.score}`);
      else yield* Console.error(highlighter.gray(noScoreMessage));
      return buildResult();
    }

    const animateRender =
      !options.silent && !options.verbose && canAnimateOnboarding(process.stdout);
    const pause = onboardingSectionPause(animateRender);
    const useHyperlinks = shouldRenderHyperlinks(process.stdout);
    const demotedDiagnosticCount = diagnostics.length - surfaceDiagnostics.length;
    const isDiffMode = options.includePaths.length > 0;
    const lintSourceFileCount = isDiffMode ? options.includePaths.length : project.sourceFileCount;

    if (printedDiagnostics.length === 0) {
      yield* pause;
      if (hasSkippedChecks) {
        const skippedLabel = skippedChecks.join(" and ");
        yield* Console.warn(
          highlighter.warn(
            `No issues detected, but ${skippedLabel} checks failed — results are incomplete.`,
          ),
        );
      } else if (options.categoryFilters.size > 0) {
        yield* Console.log(
          highlighter.success(
            `No issues found in category ${formatCategorySelection(options.categoryFilters)}!`,
          ),
        );
      } else if (demotedDiagnosticCount > 0) {
        yield* Console.log(
          highlighter.success(
            `No issues found! (${demotedDiagnosticCount} demoted from the ${options.outputSurface} surface — see config.surfaces.)`,
          ),
        );
      } else {
        yield* Console.log(highlighter.success("No issues found!"));
      }
      yield* Console.log("");
      yield* pause;
      if (hasSkippedChecks) {
        yield* printBrandingOnlyHeader;
        yield* Console.log(highlighter.gray("  Score not shown — some checks could not complete."));
      } else if (score) {
        yield* printScoreHeader(score);
      } else {
        yield* printNoScoreHeader(noScoreMessage);
      }
      if (options.outputDirectory !== null) {
        yield* printDiagnosticsDump(printedDiagnostics, options.outputDirectory);
      }
      return buildResult();
    }

    yield* pause;
    yield* Console.log("");
    yield* printDiagnostics(
      [...printedDiagnostics],
      options.verbose,
      directory,
      buildRulePriorityMap([score]),
      isCodingAgentEnvironment(),
      { sectionPause: pause, animateCountUp: animateRender },
      useHyperlinks,
    );
    if (options.isNonInteractiveEnvironment && options.outputSurface !== "prComment") {
      yield* printAgentGuidance();
    }

    if (options.categoryFilters.size === 0 && demotedDiagnosticCount > 0) {
      yield* Console.log(
        highlighter.gray(
          `  ${demotedDiagnosticCount} demoted from the ${options.outputSurface} surface (e.g. design cleanup) — run \`npx react-doctor@latest .\` locally for the full list.`,
        ),
      );
      yield* Console.log("");
    }

    const scoreDiagnostics = filterDiagnosticsForSurface([...diagnostics], "score", userConfig);
    const displayedScoreDiagnostics = filterDiagnosticsForSurface(
      [...printedDiagnostics],
      "score",
      userConfig,
    );
    const potentialScore = score
      ? yield* Effect.promise(() =>
          computeProjectedScore(displayedScoreDiagnostics, scoreDiagnostics, score),
        )
      : null;

    const showShareLink = shouldShowShareLink(options);
    yield* pause;
    yield* printSummary({
      diagnostics: [...printedDiagnostics],
      elapsedMilliseconds,
      scoreResult: score,
      potentialScore,
      totalSourceFileCount: lintSourceFileCount,
      noScoreMessage,
      verbose: options.verbose,
      outputDirectory: options.outputDirectory,
      animateProjection: animateRender,
    });

    if (hasSkippedChecks) {
      const skippedLabel = skippedChecks.join(" and ");
      yield* Console.log("");
      yield* Console.warn(
        highlighter.warn(`  Note: ${skippedLabel} checks failed — score may be incomplete.`),
      );
    }

    yield* pause;
    yield* printFooter({
      diagnostics: [...printedDiagnostics],
      scoreResult: score,
      projectName: project.projectName,
      isOffline: !showShareLink,
    });

    return buildResult();
  });
