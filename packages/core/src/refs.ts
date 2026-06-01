import * as Context from "effect/Context";
import {
  MIN_SCAN_CONCURRENCY,
  OXLINT_OUTPUT_MAX_BYTES,
  OXLINT_SPAWN_TIMEOUT_MS,
} from "./constants.js";
import { resolveScanConcurrency } from "./utils/resolve-scan-concurrency.js";

/**
 * Per-batch oxlint wall-clock budget. Reads from the env var on
 * startup so the eval harness can raise the budget under sandbox
 * microVMs without recompiling react-doctor. Tests override via
 * `Layer.succeed(OxlintSpawnTimeoutMs, ...)`.
 */
export class OxlintSpawnTimeoutMs extends Context.Reference<number>(
  "react-doctor/OxlintSpawnTimeoutMs",
  {
    defaultValue: () => {
      const raw = process.env["REACT_DOCTOR_OXLINT_SPAWN_TIMEOUT_MS"];
      if (raw === undefined) return OXLINT_SPAWN_TIMEOUT_MS;
      const parsed = Number(raw);
      if (!Number.isFinite(parsed) || parsed <= 0) return OXLINT_SPAWN_TIMEOUT_MS;
      return parsed;
    },
  },
) {}

/**
 * Hard cap on combined stdout+stderr bytes per oxlint batch. The
 * subprocess gets SIGKILL'd if it produces more; the recovery path
 * suggests narrowing the scan with --diff. Override via Layer in
 * tests that exercise the cap behavior.
 */
export class OxlintOutputMaxBytes extends Context.Reference<number>(
  "react-doctor/OxlintOutputMaxBytes",
  {
    defaultValue: () => OXLINT_OUTPUT_MAX_BYTES,
  },
) {}

/**
 * Number of oxlint subprocesses the lint pass runs in parallel. Defaults
 * to `1` (serial — the historical behavior) so resource usage is opt-in.
 * The CLI's `--experimental-parallel` flag overrides this via `Layer.succeed`; the
 * `REACT_DOCTOR_PARALLEL` env var seeds the default for programmatic /
 * CI callers that never touch the flag:
 *
 *   - unset / `0` / `false` / `off` → `1` (serial)
 *   - `auto` / `true` / `on`        → available CPU cores (clamped)
 *   - a positive integer            → that many workers (clamped)
 *
 * The resolved value is always within
 * `[MIN_SCAN_CONCURRENCY, MAX_SCAN_CONCURRENCY]`.
 */
export class OxlintConcurrency extends Context.Reference<number>("react-doctor/OxlintConcurrency", {
  defaultValue: () => {
    const raw = process.env["REACT_DOCTOR_PARALLEL"];
    if (raw === undefined) return MIN_SCAN_CONCURRENCY;
    const normalized = raw.trim().toLowerCase();
    if (normalized === "" || normalized === "0" || normalized === "false" || normalized === "off") {
      return MIN_SCAN_CONCURRENCY;
    }
    if (normalized === "auto" || normalized === "true" || normalized === "on") {
      return resolveScanConcurrency("auto");
    }
    const parsed = Number.parseInt(normalized, 10);
    if (!Number.isInteger(parsed) || parsed <= 0) return MIN_SCAN_CONCURRENCY;
    return resolveScanConcurrency(parsed);
  },
}) {}
