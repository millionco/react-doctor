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
 * to auto-detected CPU cores (parallel) so large repos scan fast out of
 * the box; `spawnLintBatches` transparently falls back to a single worker
 * if a parallel run exhausts system resources. The CLI's `--no-parallel`
 * flag forces serial via `Layer.succeed`; the `REACT_DOCTOR_PARALLEL` env
 * var seeds the default for programmatic / CI callers that never touch the
 * flag — parallelism is opt-OUT, so only the explicit serial values pin
 * one worker:
 *
 *   - unset / `auto` / `true` / `on`  → available CPU cores (clamped)
 *   - `0` / `false` / `off`           → `1` (serial)
 *   - a positive integer              → that many workers (clamped)
 *   - any other value                 → available CPU cores (clamped)
 *
 * The resolved value is always within
 * `[MIN_SCAN_CONCURRENCY, MAX_SCAN_CONCURRENCY]`.
 */
export class OxlintConcurrency extends Context.Reference<number>("react-doctor/OxlintConcurrency", {
  defaultValue: () => {
    const raw = process.env["REACT_DOCTOR_PARALLEL"];
    if (raw === undefined) return resolveScanConcurrency("auto");
    const normalized = raw.trim().toLowerCase();
    if (normalized === "0" || normalized === "false" || normalized === "off") {
      return MIN_SCAN_CONCURRENCY;
    }
    const parsed = Number.parseInt(normalized, 10);
    // A positive integer pins the worker count; everything else (empty,
    // `auto`/`true`/`on`, or unparseable) takes the parallel default.
    if (Number.isInteger(parsed) && parsed > 0) return resolveScanConcurrency(parsed);
    return resolveScanConcurrency("auto");
  },
}) {}
