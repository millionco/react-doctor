import os from "node:os";
import { PER_WORKER_MEM_BUDGET_BYTES } from "../constants.js";
import { readCgroupMemoryLimitBytes } from "./read-cgroup-memory-limit-bytes.js";
import { resolveScanConcurrency } from "./resolve-scan-concurrency.js";

export interface AutoScanConcurrencyFacts {
  /** `os.availableParallelism()` — already cgroup-CPU-aware on the supported Node range. */
  readonly availableCores: number;
  /** `os.totalmem()` — the HOST total; floored by `cgroupMemoryLimitBytes` below. */
  readonly totalMemoryBytes: number;
  /** The cgroup memory limit, or `undefined` when there is none (bare metal / dev machines). */
  readonly cgroupMemoryLimitBytes: number | undefined;
}

const readSystemFacts = (): AutoScanConcurrencyFacts => ({
  availableCores: os.availableParallelism(),
  totalMemoryBytes: os.totalmem(),
  cgroupMemoryLimitBytes: readCgroupMemoryLimitBytes(),
});

/**
 * Auto lint-worker count: the smaller of the (cgroup-CPU-aware) core count and
 * the number of `PER_WORKER_MEM_BUDGET_BYTES` workers that fit in available
 * memory, then clamped to `[MIN, HARD_MAX]` by `resolveScanConcurrency`.
 *
 * `os.availableParallelism()` already respects cgroup CPU quotas, so the core
 * term needs no help. Available memory is `os.totalmem()` floored by the cgroup
 * memory limit — `os.freemem()` is deliberately NOT used: it excludes
 * reclaimable page cache and reads near-zero on macOS / cache-heavy Linux, which
 * would collapse the auto path to a single worker. `os.totalmem()` reports the
 * host total even inside a container, so the cgroup limit (read directly,
 * because Node doesn't fold it into `totalmem()`) is the real ceiling there.
 *
 * `facts` is injectable so tests exercise core-bound, memory-bound, cgroup-
 * limited, and ceiling cases without mocking `os` or the filesystem.
 */
export const resolveAutoScanConcurrency = (
  facts: AutoScanConcurrencyFacts = readSystemFacts(),
): number => {
  const availableMemoryBytes = Math.min(
    facts.totalMemoryBytes,
    facts.cgroupMemoryLimitBytes ?? Number.POSITIVE_INFINITY,
  );
  const memoryBoundedWorkers = Math.floor(availableMemoryBytes / PER_WORKER_MEM_BUDGET_BYTES);
  return resolveScanConcurrency(Math.min(facts.availableCores, memoryBoundedWorkers));
};
