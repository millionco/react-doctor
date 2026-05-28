import os from "node:os";
import { LINT_BATCH_CONCURRENCY_MAX } from "../constants.js";

/**
 * Resolves how many oxlint batch subprocesses `spawnLintBatches` runs
 * at once. Defaults to the machine's available parallelism, clamped to
 * `LINT_BATCH_CONCURRENCY_MAX` so a many-core CI box doesn't spawn
 * dozens of oxlint processes simultaneously — each holds up to
 * `OXLINT_MAX_FILES_PER_BATCH` files in oxlint's native binding, the
 * very memory pressure the batching guards against.
 *
 * `REACT_DOCTOR_LINT_CONCURRENCY` overrides the pool size for
 * hand-tuned runs: `1` forces the legacy one-batch-at-a-time behavior;
 * a higher number opts a memory-rich runner into more parallelism than
 * the default cap. Non-numeric or sub-1 values fall back to the
 * derived default. Mirrors the env-override pattern
 * `REACT_DOCTOR_OXLINT_SPAWN_TIMEOUT_MS` already uses in `spawn-oxlint.ts`.
 */
export const resolveLintConcurrency = (): number => {
  const override = process.env["REACT_DOCTOR_LINT_CONCURRENCY"];
  if (override !== undefined) {
    const parsed = Number(override);
    if (Number.isFinite(parsed) && parsed >= 1) {
      return Math.floor(parsed);
    }
  }
  const availableParallelism =
    typeof os.availableParallelism === "function" ? os.availableParallelism() : os.cpus().length;
  return Math.max(1, Math.min(availableParallelism, LINT_BATCH_CONCURRENCY_MAX));
};
