import os from "node:os";
import { MAX_SCAN_CONCURRENCY, MIN_SCAN_CONCURRENCY } from "../constants.js";

/**
 * Resolves a requested lint worker count to a clamped integer within
 * `[MIN_SCAN_CONCURRENCY, MAX_SCAN_CONCURRENCY]`. `"auto"` uses the
 * machine's CPU cores; out-of-range or non-finite requests degrade to
 * `MIN_SCAN_CONCURRENCY` rather than oversubscribing or running zero workers.
 */
export const resolveScanConcurrency = (requested: number | "auto"): number => {
  const desired = requested === "auto" ? os.availableParallelism() : requested;
  if (!Number.isFinite(desired) || desired < MIN_SCAN_CONCURRENCY) return MIN_SCAN_CONCURRENCY;
  return Math.max(MIN_SCAN_CONCURRENCY, Math.min(Math.floor(desired), MAX_SCAN_CONCURRENCY));
};
