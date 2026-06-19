import os from "node:os";
import { describe, expect, it } from "vite-plus/test";
import { HARD_MAX_SCAN_CONCURRENCY, MIN_SCAN_CONCURRENCY } from "../src/constants.js";
import { readCgroupMemoryLimitBytes } from "../src/utils/read-cgroup-memory-limit-bytes.js";
import { resolveAutoScanConcurrency } from "../src/utils/resolve-auto-scan-concurrency.js";

const GIB = 1024 * 1024 * 1024;
const MIB = 1024 * 1024;

describe("resolveAutoScanConcurrency", () => {
  it("is core-bound when memory is plentiful", () => {
    // floor(64 GiB / 1 GiB) = 64 workers fit, so the 8 cores bind.
    expect(
      resolveAutoScanConcurrency({
        availableCores: 8,
        totalMemoryBytes: 64 * GIB,
        cgroupMemoryLimitBytes: undefined,
      }),
    ).toBe(8);
  });

  it("does not regress a 16-core / 16 GiB machine below the old fixed ceiling", () => {
    // 1 GiB/worker is calibrated so the common 1 GiB/core shape stays core-bound:
    // floor(16 / 1) = 16, so a 16-core box still runs 16 workers (not fewer).
    expect(
      resolveAutoScanConcurrency({
        availableCores: 16,
        totalMemoryBytes: 16 * GIB,
        cgroupMemoryLimitBytes: undefined,
      }),
    ).toBe(16);
  });

  it("is memory-bound on a high-core / memory-starved box", () => {
    // floor(6 GiB / 1 GiB) = 6 — a 64-core box with little RAM does NOT spawn
    // 32 workers (the native-binding SIGABRT trap this budget exists to avoid).
    expect(
      resolveAutoScanConcurrency({
        availableCores: 64,
        totalMemoryBytes: 6 * GIB,
        cgroupMemoryLimitBytes: undefined,
      }),
    ).toBe(6);
  });

  it("honors a cgroup memory limit below the host total", () => {
    // The container sees 200 GiB of HOST memory via os.totalmem(), but its
    // cgroup caps it at 4 GiB → floor(4 / 1) = 4. This is the case Node's
    // totalmem()/freemem() both get wrong without the direct cgroup read.
    expect(
      resolveAutoScanConcurrency({
        availableCores: 64,
        totalMemoryBytes: 200 * GIB,
        cgroupMemoryLimitBytes: 4 * GIB,
      }),
    ).toBe(4);
  });

  it("never exceeds HARD_MAX_SCAN_CONCURRENCY", () => {
    expect(
      resolveAutoScanConcurrency({
        availableCores: 128,
        totalMemoryBytes: 256 * GIB,
        cgroupMemoryLimitBytes: undefined,
      }),
    ).toBe(HARD_MAX_SCAN_CONCURRENCY);
  });

  it("floors to MIN when not even one worker's budget fits", () => {
    expect(
      resolveAutoScanConcurrency({
        availableCores: 64,
        totalMemoryBytes: 256 * MIB,
        cgroupMemoryLimitBytes: undefined,
      }),
    ).toBe(MIN_SCAN_CONCURRENCY);
  });

  it("returns an integer within [MIN, HARD_MAX] on the real system", () => {
    const resolved = resolveAutoScanConcurrency();
    expect(Number.isInteger(resolved)).toBe(true);
    expect(resolved).toBeGreaterThanOrEqual(MIN_SCAN_CONCURRENCY);
    expect(resolved).toBeLessThanOrEqual(HARD_MAX_SCAN_CONCURRENCY);
  });

  it("sources total (not free) memory on the real system", () => {
    // Pins that the default facts use os.totalmem() + os.availableParallelism()
    // + the cgroup limit. If `readSystemFacts` ever regressed to os.freemem()
    // (which reads ~0 of a large total on macOS / cache-heavy Linux, collapsing
    // the scan to one worker), the no-arg call would diverge from this
    // total-memory recomputation and this assertion would fail.
    const fromTotalMemory = resolveAutoScanConcurrency({
      availableCores: os.availableParallelism(),
      totalMemoryBytes: os.totalmem(),
      cgroupMemoryLimitBytes: readCgroupMemoryLimitBytes(),
    });
    expect(resolveAutoScanConcurrency()).toBe(fromTotalMemory);
  });
});
