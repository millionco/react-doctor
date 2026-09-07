import {
  MIN_SCAN_CONCURRENCY,
  NATIVE_OXLINT_THREADS_PER_WORKER,
  NATIVE_REACT_DOCTOR_PLUGIN_NAME,
  OXLINT_MAX_FILES_PER_BATCH,
} from "../constants.js";
import type { createOxlintConfig } from "../runners/oxlint/config.js";
import type { WorkerSlots } from "./create-worker-slots.js";
import { resolveScanConcurrency } from "./resolve-scan-concurrency.js";

export interface ResolveNativeOxlintThreadCountOptions {
  readonly config: ReturnType<typeof createOxlintConfig>;
  readonly nativeBindingPath: string;
  readonly concurrency: number | undefined;
  readonly spawnSlots: WorkerSlots | undefined;
  readonly fileCount: number;
  readonly availableThreads: number;
}

export const resolveNativeOxlintThreadCount = ({
  config,
  nativeBindingPath,
  concurrency,
  spawnSlots,
  fileCount,
  availableThreads,
}: ResolveNativeOxlintThreadCountOptions): number | undefined => {
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
  return ruleKeys.length > 0 &&
    ruleKeys.every((rule) => rule.startsWith(`${NATIVE_REACT_DOCTOR_PLUGIN_NAME}/`))
    ? NATIVE_OXLINT_THREADS_PER_WORKER
    : undefined;
};
