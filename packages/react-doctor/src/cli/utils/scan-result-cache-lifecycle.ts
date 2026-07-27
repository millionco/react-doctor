import type { ReactDoctorConfig } from "../../core/core-configuration.js";
import type { InspectResult } from "../../core/core-types.js";
import type { ResolvedInspectOptions } from "../../contracts/inspect-options.js";
import { METRIC } from "./constants.js";
import { recordCount } from "./record-metric.js";
import {
  buildScanResultCacheKey,
  createScanResultCache,
  shouldStoreScanPayload,
  type CachedScanPayload,
} from "./scan-result-cache.js";
import { buildScanResultCachePolicy } from "./scan-result-cache-policy.js";
import type {
  RenderAndRecordScanInput,
  RenderCachedProjectDetectionInput,
} from "./render-inspect-result.js";
export type {
  RenderAndRecordScanInput,
  RenderCachedProjectDetectionInput,
} from "./render-inspect-result.js";
import type { SentryRootSpan } from "./with-sentry-run-span.js";
import { recordSentryProjectContext } from "./with-sentry-run-span.js";
import { VERSION } from "./version.js";

export interface CreateScanResultCacheLifecycleInput {
  readonly directory: string;
  readonly options: ResolvedInspectOptions;
  readonly userConfig: ReactDoctorConfig | null;
  readonly hasConfigOverride: boolean;
  readonly configSourceDirectory: string | null;
  readonly resolvedNodeBinaryPath: string | null;
  readonly startTime: number;
  readonly rootSentrySpan: SentryRootSpan;
  readonly renderCachedProjectDetection: (
    input: RenderCachedProjectDetectionInput,
  ) => Promise<void>;
  readonly renderAndRecordScan: (input: RenderAndRecordScanInput) => Promise<InspectResult>;
  readonly recordOnboardingCompletion: (options: ResolvedInspectOptions) => void;
}

export interface CompleteScanResultCacheInput {
  readonly payload: CachedScanPayload;
  readonly scanMode: RenderAndRecordScanInput["scanMode"];
  readonly baselineDegraded: boolean;
  readonly lintCacheHitFileCount: number | null;
  readonly lintCacheTotalFileCount: number | null;
  readonly lintSidecarReplayedFileCount: number | null;
  readonly lintSidecarTotalFileCount: number | null;
  readonly deadCodeCacheHit: boolean | null;
  readonly deadCodeSummaryCacheHits: number | null;
  readonly deadCodeSummaryCacheMisses: number | null;
}

export interface ScanResultCacheLifecycle {
  // A miss is synchronous so cold scans do not yield before runtime construction.
  readonly replay: () => Promise<InspectResult> | null;
  readonly complete: (input: CompleteScanResultCacheInput) => Promise<InspectResult>;
}

export const createScanResultCacheLifecycle = (
  input: CreateScanResultCacheLifecycleInput,
): ScanResultCacheLifecycle => {
  const cacheKey = buildScanResultCacheKey({
    projectDirectory: input.directory,
    version: VERSION,
    nodeBinaryPath: input.resolvedNodeBinaryPath,
    policy: buildScanResultCachePolicy(input.options),
    userConfig: input.userConfig,
    hasConfigOverride: input.hasConfigOverride,
    configSourceDirectory: input.configSourceDirectory,
  });
  const scanResultCache = cacheKey === null ? null : createScanResultCache(input.directory);
  const cachedPayload = cacheKey === null ? null : (scanResultCache?.lookup(cacheKey) ?? null);

  return {
    replay: () => {
      if (cachedPayload === null) return null;

      return (async () => {
        const isDiffMode = input.options.includePaths.length > 0;
        recordSentryProjectContext(cachedPayload.project, input.rootSentrySpan, {
          concurrentScan: input.options.concurrentScan,
        });
        recordCount(METRIC.projectDetected, 1);
        await input.renderCachedProjectDetection({
          payload: cachedPayload,
          options: input.options,
          userConfig: input.userConfig,
          isDiffMode,
        });
        const baselineDegraded =
          Boolean(input.options.baseline) &&
          isDiffMode &&
          cachedPayload.baselineDelta === undefined;
        let scanMode: RenderAndRecordScanInput["scanMode"] = "full";
        if (cachedPayload.baselineDelta) scanMode = "baseline";
        else if (isDiffMode) scanMode = "diff";
        const result = await input.renderAndRecordScan({
          payload: cachedPayload,
          options: input.options,
          userConfig: input.userConfig,
          hasCustomConfig: input.userConfig !== null,
          startTime: input.startTime,
          rootSentrySpan: input.rootSentrySpan,
          scanMode,
          baselineDegraded,
          wholeRepoCacheHit: true,
        });
        input.recordOnboardingCompletion(input.options);
        return result;
      })();
    },
    complete: async (completion) => {
      if (
        cacheKey !== null &&
        scanResultCache !== null &&
        shouldStoreScanPayload(completion.payload) &&
        !completion.baselineDegraded
      ) {
        scanResultCache.store(cacheKey, completion.payload);
      }
      const result = await input.renderAndRecordScan({
        payload: completion.payload,
        options: input.options,
        userConfig: input.userConfig,
        hasCustomConfig: input.userConfig !== null,
        startTime: input.startTime,
        rootSentrySpan: input.rootSentrySpan,
        scanMode: completion.scanMode,
        baselineDegraded: completion.baselineDegraded,
        wholeRepoCacheHit: false,
        lintCacheHitFileCount: completion.lintCacheHitFileCount,
        lintCacheTotalFileCount: completion.lintCacheTotalFileCount,
        lintSidecarReplayedFileCount: completion.lintSidecarReplayedFileCount,
        lintSidecarTotalFileCount: completion.lintSidecarTotalFileCount,
        deadCodeCacheHit: completion.deadCodeCacheHit,
        deadCodeSummaryCacheHits: completion.deadCodeSummaryCacheHits,
        deadCodeSummaryCacheMisses: completion.deadCodeSummaryCacheMisses,
      });
      input.recordOnboardingCompletion(input.options);
      return result;
    },
  };
};
