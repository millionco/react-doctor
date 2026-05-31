import { resolveScanConcurrency } from "@react-doctor/core";

/**
 * Translates the `--parallel [workers]` flag into a concrete, clamped
 * worker count for `InspectOptions.concurrency`.
 *
 *   - flag absent (`undefined`) / `--parallel false` → `undefined`
 *     (leave the ambient default: serial unless `REACT_DOCTOR_PARALLEL`)
 *   - `--parallel` with no value / `--parallel auto`  → auto-detect cores
 *   - `--parallel <n>`                                → `n` workers (clamped)
 *   - an unparseable value                            → auto-detect cores
 *
 * Commander yields `true` for a bare `--parallel`, the raw string for
 * `--parallel <value>`, and `undefined` when the flag is omitted.
 */
export const resolveParallelFlag = (parallel: string | boolean | undefined): number | undefined => {
  if (parallel === undefined || parallel === false) return undefined;
  if (parallel === true) return resolveScanConcurrency("auto");

  const normalized = parallel.trim().toLowerCase();
  if (normalized === "" || normalized === "auto" || normalized === "true") {
    return resolveScanConcurrency("auto");
  }
  if (normalized === "false" || normalized === "off" || normalized === "0") {
    return undefined;
  }
  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) return resolveScanConcurrency("auto");
  return resolveScanConcurrency(parsed);
};
