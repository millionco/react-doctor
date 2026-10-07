import { OxlintSpawnFailed, ReactDoctorError } from "../errors.js";
import { createWorkerSlots } from "./create-worker-slots.js";
import type { WorkerSlots } from "./create-worker-slots.js";
import { resolveScanConcurrency } from "./resolve-scan-concurrency.js";

/**
 * Invocation-wide oxlint scheduling handle. One is created per scan
 * invocation (a CLI run, one `diagnose()` call), so its epoch also
 * identifies the window during which the filesystem is treated as frozen:
 * pooled workers keep plugin filesystem caches warm across jobs that share
 * an epoch and drop them when it changes.
 */
export interface OxlintSpawnSlotsHandle extends WorkerSlots {
  readonly filesystemCacheEpoch: number;
}

let nextFilesystemCacheEpoch = 1;

const createLintPhaseAbortError = (): ReactDoctorError =>
  new ReactDoctorError({
    reason: new OxlintSpawnFailed({ cause: "lint phase aborted" }),
  });

export const createOxlintSpawnSlots = (concurrency: number): OxlintSpawnSlotsHandle => {
  const filesystemCacheEpoch = nextFilesystemCacheEpoch;
  nextFilesystemCacheEpoch += 1;
  return {
    ...createWorkerSlots({
      slotCount: resolveScanConcurrency(concurrency),
      createAbortError: createLintPhaseAbortError,
    }),
    filesystemCacheEpoch,
  };
};
