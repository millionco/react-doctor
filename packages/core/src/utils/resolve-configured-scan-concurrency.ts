import { MIN_SCAN_CONCURRENCY } from "../constants.js";
import { resolveAutoScanConcurrency } from "./resolve-auto-scan-concurrency.js";
import { resolveScanConcurrency } from "./resolve-scan-concurrency.js";

// `REACT_DOCTOR_PARALLEL`: `0` / `false` / `off` pin one worker, a positive
// integer pins that count (clamped), anything else takes the auto budget.
export const resolveConfiguredScanConcurrency = (): number => {
  const raw = process.env["REACT_DOCTOR_PARALLEL"];
  if (raw === undefined) return resolveAutoScanConcurrency();
  const normalized = raw.trim().toLowerCase();
  if (normalized === "0" || normalized === "false" || normalized === "off") {
    return MIN_SCAN_CONCURRENCY;
  }
  const parsed = Number.parseInt(normalized, 10);
  if (Number.isInteger(parsed) && parsed > 0) return resolveScanConcurrency(parsed);
  return resolveAutoScanConcurrency();
};
