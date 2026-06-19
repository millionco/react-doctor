import { HARD_MAX_SCAN_CONCURRENCY, MIN_SCAN_CONCURRENCY } from "../constants.js";

/**
 * Clamps a requested lint worker count to `[MIN_SCAN_CONCURRENCY,
 * HARD_MAX_SCAN_CONCURRENCY]` as a finite integer. This is the explicit-pin and
 * spawn-boundary clamp — the memory-and-core-budgeted auto count comes from
 * `resolveAutoScanConcurrency`. Out-of-range or non-finite requests degrade to
 * `MIN_SCAN_CONCURRENCY` rather than oversubscribing or running zero workers.
 */
export const resolveScanConcurrency = (requested: number): number => {
  if (!Number.isFinite(requested) || requested < MIN_SCAN_CONCURRENCY) return MIN_SCAN_CONCURRENCY;
  return Math.min(Math.floor(requested), HARD_MAX_SCAN_CONCURRENCY);
};
