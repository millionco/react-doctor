import { describe, expect, it } from "vite-plus/test";
import {
  BYTES_PER_MEGABYTE,
  DEAD_CODE_WORKER_RSS_ESTIMATE_MB,
  MEMORY_OVERLAP_SAFETY_MARGIN_MB,
  OXLINT_WORKER_RSS_ESTIMATE_MB,
} from "../src/constants.js";
import { hasDeadCodeOverlapHeadroom } from "../src/utils/has-dead-code-overlap-headroom.js";

// Derive the boundary from the real constants so the test tracks any future
// retune of the estimate rather than hard-coding a stale number. Budgets
// against the EXPECTED dead-code RSS, not its 8 GB --max-old-space ceiling.
const estimatedPeakBytes = (workerCount: number): number =>
  (workerCount * OXLINT_WORKER_RSS_ESTIMATE_MB +
    DEAD_CODE_WORKER_RSS_ESTIMATE_MB +
    MEMORY_OVERLAP_SAFETY_MARGIN_MB) *
  BYTES_PER_MEGABYTE;

const gibibytesToBytes = (gibibytes: number): number => gibibytes * 1024 * BYTES_PER_MEGABYTE;

describe("hasDeadCodeOverlapHeadroom", () => {
  it("overlaps when available memory comfortably exceeds the estimated peak (16 workers, 24 GiB)", () => {
    expect(
      hasDeadCodeOverlapHeadroom({ workerCount: 16, availableBytes: gibibytesToBytes(24) }),
    ).toBe(true);
  });

  it("opens on a typical 16 GB MacBook (10 workers, ~9 GiB available)", () => {
    // The bug this fix closes: with the old 8 GB-ceiling budget this needed
    // ~14 GiB and NEVER opened on a 16 GB box; against the expected ~2 GB
    // dead-code RSS the budget is ~8 GiB, so a normal laptop with headroom
    // overlaps and saturates CPU + memory at once.
    expect(
      hasDeadCodeOverlapHeadroom({ workerCount: 10, availableBytes: gibibytesToBytes(9) }),
    ).toBe(true);
  });

  it("stays sequential at the failure boundary the gate exists to prevent (16 workers on a 4 GiB box)", () => {
    // Genuinely memory-pressured: overlapping the dead-code worker onto 16
    // oxlint children here risks the OOM the dead-code worker is prone to, so
    // the gate correctly keeps the phases sequential.
    expect(
      hasDeadCodeOverlapHeadroom({ workerCount: 16, availableBytes: gibibytesToBytes(4) }),
    ).toBe(false);
  });

  it("overlaps for a single (serial) worker with modest available memory", () => {
    expect(
      hasDeadCodeOverlapHeadroom({ workerCount: 1, availableBytes: gibibytesToBytes(12) }),
    ).toBe(true);
  });

  it("opens exactly at the estimated peak and closes one byte below it", () => {
    const peak = estimatedPeakBytes(8);
    expect(hasDeadCodeOverlapHeadroom({ workerCount: 8, availableBytes: peak })).toBe(true);
    expect(hasDeadCodeOverlapHeadroom({ workerCount: 8, availableBytes: peak - 1 })).toBe(false);
  });
});
