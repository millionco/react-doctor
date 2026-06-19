import * as Context from "effect/Context";
import {
  DEAD_CODE_PHASE_TIMEOUT_MS,
  LINT_PHASE_TIMEOUT_MS,
  MIN_SCAN_CONCURRENCY,
  OXLINT_OUTPUT_MAX_BYTES,
  OXLINT_SPAWN_TIMEOUT_MS,
  SCAN_TOTAL_DEADLINE_MS,
  SUPPLY_CHAIN_OVERLAP_TIMEOUT_MS,
} from "./constants.js";
import { readPositiveEnvMs } from "./utils/read-positive-env-ms.js";
import { resolveAutoScanConcurrency } from "./utils/resolve-auto-scan-concurrency.js";
import { resolveLintBatchOrdering } from "./utils/resolve-lint-batch-ordering.js";
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
 * Wall-clock budget for the supply-chain check when it runs on a background
 * fiber overlapping the lint pass. Reads from the env var on startup so the
 * eval harness can raise the budget under sandbox microVMs (slower network)
 * without recompiling react-doctor. Tests override via
 * `Layer.succeed(SupplyChainOverlapTimeoutMs, ...)`.
 */
export class SupplyChainOverlapTimeoutMs extends Context.Reference<number>(
  "react-doctor/SupplyChainOverlapTimeoutMs",
  {
    defaultValue: () => {
      const raw = process.env["REACT_DOCTOR_SUPPLY_CHAIN_TIMEOUT_MS"];
      if (raw === undefined) return SUPPLY_CHAIN_OVERLAP_TIMEOUT_MS;
      const parsed = Number(raw);
      if (!Number.isFinite(parsed) || parsed <= 0) return SUPPLY_CHAIN_OVERLAP_TIMEOUT_MS;
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

/**
 * Three-state control for overlapping the dead-code pass with the lint pass —
 * forking dead-code as a child fiber that runs DURING lint instead of strictly
 * after it.
 *
 *   - `"auto"` (default) → defer to the runtime memory gate
 *     (`hasDeadCodeOverlapHeadroom`): overlap only when there's headroom to run
 *     the 8 GB dead-code child alongside the oxlint workers, else stay
 *     sequential.
 *   - `"on"`  → force overlap regardless of the gate.
 *   - `"off"` → force the strictly-sequential (pre-overlap) behavior.
 *
 * Seeded from `REACT_DOCTOR_DEAD_CODE_OVERLAP` so operators get a redeploy-free
 * kill switch; tests pin it via `Layer.succeed(DeadCodeOverlap, ...)`.
 */
export class DeadCodeOverlap extends Context.Reference<"auto" | "on" | "off">(
  "react-doctor/DeadCodeOverlap",
  {
    defaultValue: () => {
      const raw = process.env["REACT_DOCTOR_DEAD_CODE_OVERLAP"]?.trim().toLowerCase();
      if (raw === "on" || raw === "true" || raw === "1") return "on";
      if (raw === "off" || raw === "false" || raw === "0") return "off";
      return "auto";
    },
  },
) {}

/**
 * How the full-scan lint pass orders its file batches. `"cost"` (the default)
 * feeds the largest files into the parallel pool first so the heaviest batch
 * starts in wave 1 instead of stranding in the tail (LPT). Set
 * `REACT_DOCTOR_LINT_BATCH_ORDERING=arrival` to fall back to discovery order —
 * the one-env-var revert if the kill metric (`Linter.run` p95 / dropped-file
 * rate by cohort) fires, no code deploy needed. Tests override via
 * `Layer.succeed(LintBatchOrdering, ...)`. Diff / staged scans never reach this
 * — they pass user-scoped `includePaths` that skip discovery and stay in
 * arrival order; only the full-scan branch reads it.
 */
export class LintBatchOrdering extends Context.Reference<"cost" | "arrival">(
  "react-doctor/LintBatchOrdering",
  {
    defaultValue: resolveLintBatchOrdering,
  },
) {}
