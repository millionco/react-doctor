import os from "node:os";
import { MAX_SCAN_CONCURRENCY, MIN_SCAN_CONCURRENCY } from "../constants.js";

const detectAvailableParallelism = (): number =>
  typeof os.availableParallelism === "function" ? os.availableParallelism() : os.cpus().length;

/**
 * Resolves a requested lint worker count to a concrete, clamped integer.
 * `"auto"` reads the machine's available parallelism (CPU cores). The
 * result is always within `[MIN_SCAN_CONCURRENCY, MAX_SCAN_CONCURRENCY]`,
 * so an out-of-range or non-finite request degrades to a safe value
 * rather than oversubscribing the machine or running zero workers.
 */
export const resolveScanConcurrency = (requested: number | "auto"): number => {
  const desired = requested === "auto" ? detectAvailableParallelism() : requested;
  if (!Number.isFinite(desired) || desired < MIN_SCAN_CONCURRENCY) return MIN_SCAN_CONCURRENCY;
  return Math.max(MIN_SCAN_CONCURRENCY, Math.min(Math.floor(desired), MAX_SCAN_CONCURRENCY));
};
