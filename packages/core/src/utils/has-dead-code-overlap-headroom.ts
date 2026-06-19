import {
  BYTES_PER_MEGABYTE,
  DEAD_CODE_WORKER_RSS_ESTIMATE_MB,
  MEMORY_OVERLAP_SAFETY_MARGIN_MB,
  OXLINT_WORKER_RSS_ESTIMATE_MB,
} from "../constants.js";

interface DeadCodeOverlapHeadroomInput {
  readonly workerCount: number;
  /**
   * Allocatable memory in bytes — `resolveAvailableMemoryBytes()`, NOT
   * `os.freemem()`. freemem counts only wired+free pages and understates a
   * Mac's real headroom by gigabytes, which is why the gate never opened there.
   */
  readonly availableBytes: number;
}

/**
 * True when there is enough ALLOCATABLE memory to run the dead-code child
 * (expected RSS ≈ `DEAD_CODE_WORKER_RSS_ESTIMATE_MB`) alongside `workerCount`
 * oxlint children, so the orchestrator can overlap the two phases — saturating
 * CPU (lint workers) and memory (dead-code worker) at once — instead of running
 * them sequentially. Pure; the orchestrator decides once, at fork time.
 *
 * Budgets against the dead-code worker's EXPECTED resident set, not its 8 GB
 * `--max-old-space-size` ceiling (which it almost never reaches): gating on the
 * ceiling demanded ~14 GB free and never opened on a 16 GB box. The gate is
 * fail-safe — when memory is genuinely tight it stays sequential (today's
 * behavior, zero risk) — and the in-worker timeout + fail-open dead-code path
 * absorb the rare case where the worker overshoots the estimate under overlap.
 */
export const hasDeadCodeOverlapHeadroom = (input: DeadCodeOverlapHeadroomInput): boolean => {
  const estimatedPeakMegabytes =
    input.workerCount * OXLINT_WORKER_RSS_ESTIMATE_MB +
    DEAD_CODE_WORKER_RSS_ESTIMATE_MB +
    MEMORY_OVERLAP_SAFETY_MARGIN_MB;
  return input.availableBytes >= estimatedPeakMegabytes * BYTES_PER_MEGABYTE;
};
