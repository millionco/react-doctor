import type { InvocationCachesHandle, OxlintSpawnSlotsHandle } from "@react-doctor/core";
import type { ScanResultCacheInvocationState } from "./cli/utils/scan-result-cache.js";

export interface OxlintInvocationRuntime {
  readonly concurrency: number;
  readonly spawnSlots: OxlintSpawnSlotsHandle;
  readonly abortSignal: AbortSignal;
  readonly scanResultCacheInvocationState: ScanResultCacheInvocationState;
  readonly invocationCaches: InvocationCachesHandle;
}
