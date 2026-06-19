import * as Context from "effect/Context";
import {
  DEAD_CODE_PHASE_TIMEOUT_MS,
  LINT_PHASE_TIMEOUT_MS,
  MIN_SCAN_CONCURRENCY,
  OXLINT_OUTPUT_MAX_BYTES,
  OXLINT_SPAWN_TIMEOUT_MS,
  SCAN_TOTAL_DEADLINE_MS,
} from "./constants.js";
import { readPositiveEnvMs } from "./utils/read-positive-env-ms.js";
import { resolveAutoScanConcurrency } from "./utils/resolve-auto-scan-concurrency.js";
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
    defaultValue: () =>
      readPositiveEnvMs("REACT_DOCTOR_OXLINT_SPAWN_TIMEOUT_MS", OXLINT_SPAWN_TIMEOUT_MS),
  },
) {}

/**
 * Effect-side cap on the lint phase. The env var lets CI / eval runners
 * raise the phase budget for slow large repos without recompiling.
 * Tests override via `Layer.succeed(LintPhaseTimeoutMs, ...)`.
 */
export class LintPhaseTimeoutMs extends Context.Reference<number>(
  "react-doctor/LintPhaseTimeoutMs",
  {
    defaultValue: () =>
      readPositiveEnvMs("REACT_DOCTOR_LINT_PHASE_TIMEOUT_MS", LINT_PHASE_TIMEOUT_MS),
  },
) {}

/**
 * Effect-side cap on the dead-code phase, sitting above the in-worker
 * timeout as a runtime-independent backstop. The env var raises it for
 * type-heavy projects; tests override via
 * `Layer.succeed(DeadCodePhaseTimeoutMs, ...)`.
 */
export class DeadCodePhaseTimeoutMs extends Context.Reference<number>(
  "react-doctor/DeadCodePhaseTimeoutMs",
  {
    defaultValue: () =>
      readPositiveEnvMs("REACT_DOCTOR_DEAD_CODE_PHASE_TIMEOUT_MS", DEAD_CODE_PHASE_TIMEOUT_MS),
  },
) {}

/**
 * Overall scan deadline backstop, bounding everything the per-phase
 * timeouts don't (wedged git / IO). The env var raises it for very
 * large repos; tests override via `Layer.succeed(ScanDeadlineMs, ...)`.
 */
export class ScanDeadlineMs extends Context.Reference<number>("react-doctor/ScanDeadlineMs", {
  defaultValue: () => readPositiveEnvMs("REACT_DOCTOR_SCAN_DEADLINE_MS", SCAN_TOTAL_DEADLINE_MS),
}) {}

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
 * Number of oxlint subprocesses the lint pass runs in parallel. Defaults to a
 * memory-and-core-budgeted auto count (`resolveAutoScanConcurrency`) so large
 * repos scan fast out of the box without OOMing the native binding on a
 * high-core / low-memory box; `spawnLintBatches` transparently falls back to a
 * single worker if a parallel run still exhausts system resources. The CLI's
 * `--no-parallel` flag forces serial via `Layer.succeed`; the
 * `REACT_DOCTOR_PARALLEL` env var seeds the default for programmatic / CI
 * callers that never touch the flag — parallelism is opt-OUT, so only the
 * explicit serial values pin one worker:
 *
 *   - unset / `auto` / `true` / `on`  → memory-and-core-budgeted auto count
 *   - `0` / `false` / `off`           → `1` (serial)
 *   - a positive integer              → that many workers (clamped)
 *   - any other value                 → memory-and-core-budgeted auto count
 *
 * The resolved value is always within
 * `[MIN_SCAN_CONCURRENCY, HARD_MAX_SCAN_CONCURRENCY]`.
 */
export class OxlintConcurrency extends Context.Reference<number>("react-doctor/OxlintConcurrency", {
  defaultValue: () => {
    const raw = process.env["REACT_DOCTOR_PARALLEL"];
    if (raw === undefined) return resolveAutoScanConcurrency();
    const normalized = raw.trim().toLowerCase();
    if (normalized === "0" || normalized === "false" || normalized === "off") {
      return MIN_SCAN_CONCURRENCY;
    }
    const parsed = Number.parseInt(normalized, 10);
    // A positive integer pins the worker count; everything else (empty,
    // `auto`/`true`/`on`, or unparseable) takes the parallel default.
    if (Number.isInteger(parsed) && parsed > 0) return resolveScanConcurrency(parsed);
    return resolveAutoScanConcurrency();
  },
}) {}
