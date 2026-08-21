import type { InspectResult, ReactDoctorConfig } from "@react-doctor/core";
import type { ResolvedInspectOptions } from "../../inspect-options.js";
import { METRIC } from "./constants.js";
import type { InspectExecutionCacheStats } from "./finalize-inspect-result.js";
import { recordCount } from "./record-metric.js";
import { renderAndRecordScan, type RenderAndRecordScanInput } from "./render-and-record-scan.js";
import {
  buildScanResultCacheKey,
  createScanResultCache,
  shouldStoreScanPayload,
  type ScanResultCacheInvocationState,
} from "./scan-result-cache.js";
import type { CachedScanPayload } from "./scan-result-cache-payload.js";
import { VERSION } from "./version.js";
import { recordSentryProjectContext, type RunRootSpan } from "./with-run-span.js";

interface CreateScanResultCacheLifecycleInput {
  readonly directory: string;
  readonly options: ResolvedInspectOptions;
  readonly userConfig: ReactDoctorConfig | null;
  readonly hasConfigOverride: boolean;
  readonly configSourceDirectory: string | null;
  readonly resolvedNodeBinaryPath: string | null;
  readonly invocationState: ScanResultCacheInvocationState;
  readonly startTime: number;
  readonly rootSpan: RunRootSpan;
}

interface CompleteScanResultCacheInput {
  readonly payload: CachedScanPayload;
  readonly scanMode: RenderAndRecordScanInput["scanMode"];
  readonly baselineDegraded: boolean;
  readonly cacheStats: Partial<InspectExecutionCacheStats>;
}

interface ScanResultCacheLifecycle {
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
    options: input.options,
    userConfig: input.userConfig,
    hasConfigOverride: input.hasConfigOverride,
    configSourceDirectory: input.configSourceDirectory,
    invocationState: input.invocationState,
  });
  const scanResultCache = cacheKey === null ? null : createScanResultCache(input.directory);
  const cachedPayload =
    cacheKey === null || scanResultCache === null ? null : scanResultCache.lookup(cacheKey);

  return {
    replay: () => {
      if (cachedPayload === null) return null;

      recordSentryProjectContext(cachedPayload.project, input.rootSpan, {
        concurrentScan: input.options.concurrentScan,
      });
      recordCount(METRIC.projectDetected, 1);
      const isDiffMode = input.options.includePaths.length > 0;
      const baselineDegraded =
        Boolean(input.options.baseline) && isDiffMode && cachedPayload.baselineDelta === undefined;
      return renderAndRecordScan({
        payload: cachedPayload,
        options: input.options,
        startTime: input.startTime,
        rootSpan: input.rootSpan,
        scanMode: cachedPayload.baselineDelta ? "baseline" : isDiffMode ? "diff" : "full",
        baselineDegraded,
        wholeRepoCacheHit: true,
      });
    },
    complete: (completion) => {
      if (
        cacheKey !== null &&
        scanResultCache !== null &&
        shouldStoreScanPayload(completion.payload) &&
        !completion.baselineDegraded
      ) {
        scanResultCache.store(cacheKey, completion.payload);
      }
      return renderAndRecordScan({
        payload: completion.payload,
        options: input.options,
        startTime: input.startTime,
        rootSpan: input.rootSpan,
        scanMode: completion.scanMode,
        baselineDegraded: completion.baselineDegraded,
        wholeRepoCacheHit: false,
        cacheStats: completion.cacheStats,
      });
    },
  };
};
