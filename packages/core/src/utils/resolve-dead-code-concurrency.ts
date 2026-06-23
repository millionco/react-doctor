import os from "node:os";
import { DEAD_CODE_WORKER_MEM_BUDGET_BYTES } from "../constants.js";
import { readCgroupMemoryLimitBytes } from "./read-cgroup-memory-limit-bytes.js";

export interface DeadCodeConcurrencyFacts {
  /** `os.availableParallelism()` — cgroup-CPU-aware on the supported Node range. */
  readonly availableCores: number;
  /** `os.totalmem()` — host total, floored by `cgroupMemoryLimitBytes`. */
  readonly totalMemoryBytes: number;
  /** The cgroup memory limit, or `undefined` on bare metal. */
  readonly cgroupMemoryLimitBytes: number | undefined;
}

const readSystemFacts = (): DeadCodeConcurrencyFacts => ({
  availableCores: os.availableParallelism(),
  totalMemoryBytes: os.totalmem(),
  cgroupMemoryLimitBytes: readCgroupMemoryLimitBytes(),
});

/**
 * How many real deslop dead-code child processes may run at once, across the
 * concurrent per-project `runInspect` fibers of one CLI run. The cap is the
 * smaller of the core count and the number of `DEAD_CODE_WORKER_MEM_BUDGET_BYTES`
 * workers that fit in available memory, floored at 1.
 *
 * On a roomy dev box / CI runner this resolves high enough that every
 * concurrently-scanned project still spawns its own worker (no serialization vs
 * the prior uncapped behavior); on a memory-constrained runner it collapses
 * toward 1, so the `withDeadCodeWorkerSlot` semaphore serializes the spawns
 * instead of oversubscribing memory with N simultaneous children — the global
 * cap the per-project spawn path lacked.
 *
 * Mirrors `resolveAutoScanConcurrency` (lint), but budgets memory per the
 * heavier dead-code worker. `facts` is injectable for tests.
 */
export const resolveDeadCodeConcurrency = (
  facts: DeadCodeConcurrencyFacts = readSystemFacts(),
): number => {
  const availableMemoryBytes = Math.min(
    facts.totalMemoryBytes,
    facts.cgroupMemoryLimitBytes ?? Number.POSITIVE_INFINITY,
  );
  const memoryBoundedWorkers = Math.floor(availableMemoryBytes / DEAD_CODE_WORKER_MEM_BUDGET_BYTES);
  return Math.max(1, Math.min(facts.availableCores, memoryBoundedWorkers));
};
