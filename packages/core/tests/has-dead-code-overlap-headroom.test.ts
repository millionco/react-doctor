import { describe, expect, it } from "vite-plus/test";
import {
  BYTES_PER_MEGABYTE,
  DEAD_CODE_WORKER_MAX_OLD_SPACE_MB,
  MEMORY_OVERLAP_SAFETY_MARGIN_MB,
  OXLINT_WORKER_RSS_ESTIMATE_MB,
} from "../src/constants.js";
import { hasDeadCodeOverlapHeadroom } from "../src/utils/has-dead-code-overlap-headroom.js";

// Derive the boundary from the real constants so the test tracks any future
// retune of the estimate rather than hard-coding a stale number.
const estimatedPeakBytes = (workerCount: number): number =>
  (workerCount * OXLINT_WORKER_RSS_ESTIMATE_MB +
    DEAD_CODE_WORKER_MAX_OLD_SPACE_MB +
    MEMORY_OVERLAP_SAFETY_MARGIN_MB) *
  BYTES_PER_MEGABYTE;

const gibibytesToBytes = (gibibytes: number): number => gibibytes * 1024 * BYTES_PER_MEGABYTE;

describe("hasDeadCodeOverlapHeadroom", () => {
  it("overlaps when free memory comfortably exceeds the estimated peak (16 workers, 24 GiB free)", () => {
    expect(hasDeadCodeOverlapHeadroom({ workerCount: 16, freeBytes: gibibytesToBytes(24) })).toBe(
      true,
    );
  });

  it("stays sequential at the failure boundary the gate exists to prevent (16 workers on an 8 GiB box)", () => {
    // 16*512 + 8192 + 1024 = 17408 MiB needed; 8 GiB free is far short, so
    // overlapping here would sum the 8 GB dead-code peak onto 16 oxlint
    // children — the OOM the dead-code worker is already prone to.
    expect(hasDeadCodeOverlapHeadroom({ workerCount: 16, freeBytes: gibibytesToBytes(8) })).toBe(
      false,
    );
  });

  it("overlaps for a single (serial) worker with modest free memory", () => {
    expect(hasDeadCodeOverlapHeadroom({ workerCount: 1, freeBytes: gibibytesToBytes(12) })).toBe(
      true,
    );
  });

  it("opens exactly at the estimated peak and closes one byte below it", () => {
    const peak = estimatedPeakBytes(8);
    expect(hasDeadCodeOverlapHeadroom({ workerCount: 8, freeBytes: peak })).toBe(true);
    expect(hasDeadCodeOverlapHeadroom({ workerCount: 8, freeBytes: peak - 1 })).toBe(false);
  });
});
