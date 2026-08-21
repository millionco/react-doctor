import { performance } from "node:perf_hooks";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import type { InspectResult, ReactDoctorConfig } from "@react-doctor/core";
import type { ResolvedInspectOptions } from "../../inspect-options.js";
import { recordRunEvent, type RunEventConfig } from "./build-run-event.js";
import { countDeadlineSkippedFiles } from "./count-deadline-skipped-files.js";
import { countDroppedLintFiles } from "./count-dropped-lint-files.js";
import {
  finalizeInspectResult,
  type InspectExecutionCacheStats,
} from "./finalize-inspect-result.js";
import { makeNoopConsole } from "./noop-console.js";
import { recordScanMetrics } from "./record-scan-metrics.js";
import { resolveWorkerTelemetry } from "./resolve-worker-telemetry.js";
import type { CachedScanPayload } from "./scan-result-cache-payload.js";
import type { RunRootSpan } from "./with-run-span.js";

export interface RenderAndRecordScanInput {
  readonly payload: CachedScanPayload;
  readonly options: ResolvedInspectOptions;
  readonly startTime: number;
  readonly rootSpan: RunRootSpan;
  readonly scanMode: "full" | "diff" | "baseline";
  readonly baselineDegraded: boolean;
  readonly wholeRepoCacheHit: boolean;
  readonly cacheStats?: Partial<InspectExecutionCacheStats>;
}

const silentConsole = makeNoopConsole();

const deriveScope = (options: ResolvedInspectOptions): string => {
  if (options.baseline) return "changed";
  if (options.changedLineRanges !== null) return "lines";
  return options.includePaths.length > 0 ? "files" : "full";
};

export const buildRunEventConfig = (
  options: ResolvedInspectOptions,
  userConfig: ReactDoctorConfig | null,
  resolvedWorkerCount?: number,
): RunEventConfig => {
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
    hasCustomConfig: userConfig !== null,
    userConfig,
  };
};

export const renderAndRecordScan = async (
  input: RenderAndRecordScanInput,
): Promise<InspectResult> => {
  const cacheStats: InspectExecutionCacheStats = {
    lintCacheHitFileCount: input.cacheStats?.lintCacheHitFileCount ?? null,
    lintCacheTotalFileCount: input.cacheStats?.lintCacheTotalFileCount ?? null,
    lintSidecarReplayedFileCount: input.cacheStats?.lintSidecarReplayedFileCount ?? null,
    lintSidecarTotalFileCount: input.cacheStats?.lintSidecarTotalFileCount ?? null,
    deadCodeCacheHit: input.cacheStats?.deadCodeCacheHit ?? null,
    deadCodeSummaryCacheHits: input.cacheStats?.deadCodeSummaryCacheHits ?? null,
    deadCodeSummaryCacheMisses: input.cacheStats?.deadCodeSummaryCacheMisses ?? null,
  };
  const finalizeEffect = finalizeInspectResult({
    options: input.options,
    elapsedMilliseconds: performance.now() - input.startTime,
    payload: input.payload,
    cacheStats,
  });
  const result = await Effect.runPromise(
    input.options.silent
      ? finalizeEffect.pipe(Effect.provideService(Console.Console, silentConsole))
      : finalizeEffect,
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
    userConfig: input.payload.userConfig,
    suppressedRuleCounts: input.payload.suppressedRuleCounts ?? [],
  });
  recordRunEvent(input.rootSpan, {
    ...buildRunEventConfig(input.options, input.payload.userConfig, resolvedWorkerCount),
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
    suppressedRuleCounts: input.payload.suppressedRuleCounts ?? [],
  });
  return result;
};
