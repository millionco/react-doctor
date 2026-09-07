import {
  MIN_SCAN_CONCURRENCY,
  NATIVE_OXLINT_MAX_FILES_PER_BATCH,
  NATIVE_OXLINT_THREADS_PER_WORKER,
  NATIVE_REACT_DOCTOR_PLUGIN_NAME,
  OXLINT_MAX_FILES_PER_BATCH,
} from "../constants.js";
import type { createOxlintConfig } from "../runners/oxlint/config.js";
import type { WorkerSlots } from "./create-worker-slots.js";
import { resolveScanConcurrency } from "./resolve-scan-concurrency.js";

export interface ResolveNativeOxlintBatchOptionsInput {
  readonly config: ReturnType<typeof createOxlintConfig>;
  readonly nativeBindingPath: string;
  readonly concurrency: number | undefined;
  readonly spawnSlots: WorkerSlots | undefined;
  readonly fileCount: number;
  readonly availableThreads: number;
}

export interface NativeOxlintBatchOptions {
  readonly threadCount: number;
  readonly maxFilesPerBatch: number;
}

export const resolveNativeOxlintBatchOptions = ({
  config,
  nativeBindingPath,
  concurrency,
  spawnSlots,
  fileCount,
  availableThreads,
}: ResolveNativeOxlintBatchOptionsInput): NativeOxlintBatchOptions | undefined => {
  if (
    !nativeBindingPath ||
    config.plugins.length !== 1 ||
    config.plugins[0] !== NATIVE_REACT_DOCTOR_PLUGIN_NAME ||
    config.jsPlugins.length > 0 ||
    config.extends !== undefined ||
    !Number.isInteger(availableThreads) ||
    availableThreads < NATIVE_OXLINT_THREADS_PER_WORKER
  ) {
    return undefined;
  }
  const requestedConcurrency = resolveScanConcurrency(concurrency ?? MIN_SCAN_CONCURRENCY);
  const slotCount = spawnSlots === undefined ? requestedConcurrency : spawnSlots.slotCount;
  if (slotCount === undefined || !Number.isInteger(slotCount) || slotCount < MIN_SCAN_CONCURRENCY) {
    return undefined;
  }
  const effectiveConcurrency = Math.min(requestedConcurrency, slotCount);
  if (
    effectiveConcurrency <= MIN_SCAN_CONCURRENCY ||
    fileCount < OXLINT_MAX_FILES_PER_BATCH * effectiveConcurrency ||
    Math.floor(availableThreads / effectiveConcurrency) > NATIVE_OXLINT_THREADS_PER_WORKER
  ) {
    return undefined;
  }
  const ruleKeys = Object.keys(config.rules);
  if (
    ruleKeys.length === 0 ||
    !ruleKeys.every((rule) => rule.startsWith(`${NATIVE_REACT_DOCTOR_PLUGIN_NAME}/`))
  ) {
    return undefined;
  }
  const largerBatchCount = Math.ceil(fileCount / NATIVE_OXLINT_MAX_FILES_PER_BATCH);
  return {
    threadCount: NATIVE_OXLINT_THREADS_PER_WORKER,
    maxFilesPerBatch:
      Math.floor(availableThreads / largerBatchCount) <= NATIVE_OXLINT_THREADS_PER_WORKER
        ? NATIVE_OXLINT_MAX_FILES_PER_BATCH
        : OXLINT_MAX_FILES_PER_BATCH,
  };
};
