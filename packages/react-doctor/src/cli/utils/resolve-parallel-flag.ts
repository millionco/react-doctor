import { MIN_SCAN_CONCURRENCY, resolveScanConcurrency } from "@react-doctor/core";

/**
 * Translates the `--experimental-parallel [workers]` flag into a concrete
 * worker count for `InspectOptions.concurrency`:
 *
 *   - flag absent (`undefined`)            → `undefined` (defer to the ambient
 *     default: serial unless `REACT_DOCTOR_PARALLEL` is set)
 *   - bare flag / `auto`                    → auto-detect CPU cores
 *   - `--experimental-parallel <n>`         → `n` workers (clamped)
 *   - `false` / `off` / `0`                 → serial (an explicit opt-out, so
 *     it overrides an env-enabled default rather than deferring to it)
 *   - an unparseable value                  → auto-detect cores
 *
 * Commander yields `true` for a bare flag, the raw string for an explicit
 * value, and `undefined` when the flag is omitted.
 */
export const resolveParallelFlag = (parallel: string | boolean | undefined): number | undefined => {
  if (parallel === undefined) return undefined;
  if (parallel === true) return resolveScanConcurrency("auto");
  if (parallel === false) return MIN_SCAN_CONCURRENCY;

  const normalized = parallel.trim().toLowerCase();
  if (normalized === "" || normalized === "auto" || normalized === "true") {
    return resolveScanConcurrency("auto");
  }
  if (normalized === "false" || normalized === "off" || normalized === "0") {
    return MIN_SCAN_CONCURRENCY;
  }
  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) return resolveScanConcurrency("auto");
  return resolveScanConcurrency(parsed);
};
