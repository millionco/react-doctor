import {
  BYTES_PER_MEGABYTE,
  DEAD_CODE_WORKER_MAX_OLD_SPACE_MB,
  MEMORY_OVERLAP_SAFETY_MARGIN_MB,
  OXLINT_WORKER_RSS_ESTIMATE_MB,
} from "../constants.js";

interface DeadCodeOverlapHeadroomInput {
  readonly workerCount: number;
  readonly freeBytes: number;
}

/**
 * True when there is enough free memory to run the 8 GB-heap dead-code child
 * (`DEAD_CODE_WORKER_MAX_OLD_SPACE_MB`) alongside `workerCount` oxlint children
 * without risking the heap OOM the dead-code worker is already prone to on
 * type-heavy repos. Pure so the orchestrator decides once, at fork time, from a
 * single `os.freemem()` reading.
 *
 * The dead-code child's `--max-old-space-size` is a static ceiling unrelated to
 * available RAM, so a separate freemem-based gate is what makes overlapping it
 * with the lint pass safe: today the two phases run sequentially and their peak
 * RSS never co-resides. The estimate is intentionally generous (and the gate
 * fail-safe) — when free memory reads low, we stay sequential, which is exactly
 * today's behavior, so a closed gate carries no risk beyond the missed speedup.
 */
export const hasDeadCodeOverlapHeadroom = (input: DeadCodeOverlapHeadroomInput): boolean => {
  const estimatedPeakMegabytes =
    input.workerCount * OXLINT_WORKER_RSS_ESTIMATE_MB +
    DEAD_CODE_WORKER_MAX_OLD_SPACE_MB +
    MEMORY_OVERLAP_SAFETY_MARGIN_MB;
  return input.freeBytes >= estimatedPeakMegabytes * BYTES_PER_MEGABYTE;
};
