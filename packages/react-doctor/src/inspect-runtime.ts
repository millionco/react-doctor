import type { checkSecurityScanCooperative, WorkerSlots } from "@react-doctor/core";
import type { ScanResultCacheInvocationState } from "./cli/utils/scan-result-cache.js";

export interface OxlintInvocationRuntime {
  readonly concurrency: number;
  readonly spawnSlots: WorkerSlots;
  readonly abortSignal: AbortSignal;
  readonly scanResultCacheInvocationState: ScanResultCacheInvocationState;
  readonly securityScanRunner?: typeof checkSecurityScanCooperative;
}
