import { describe, expect, it } from "vite-plus/test";
import { HARD_MAX_SCAN_CONCURRENCY, MIN_SCAN_CONCURRENCY } from "../src/constants.js";
import { resolveScanConcurrency } from "../src/utils/resolve-scan-concurrency.js";

describe("resolveScanConcurrency", () => {
  it("passes through in-range integers unchanged", () => {
    expect(resolveScanConcurrency(4)).toBe(4);
    expect(resolveScanConcurrency(MIN_SCAN_CONCURRENCY)).toBe(MIN_SCAN_CONCURRENCY);
    expect(resolveScanConcurrency(HARD_MAX_SCAN_CONCURRENCY)).toBe(HARD_MAX_SCAN_CONCURRENCY);
  });

  it("clamps to HARD_MAX above the ceiling", () => {
    expect(resolveScanConcurrency(HARD_MAX_SCAN_CONCURRENCY + 100)).toBe(HARD_MAX_SCAN_CONCURRENCY);
  });

  it("clamps to MIN at or below the floor", () => {
    expect(resolveScanConcurrency(0)).toBe(MIN_SCAN_CONCURRENCY);
    expect(resolveScanConcurrency(-8)).toBe(MIN_SCAN_CONCURRENCY);
  });

  it("floors fractional requests", () => {
    expect(resolveScanConcurrency(3.9)).toBe(3);
  });

  it("falls back to MIN for non-finite requests", () => {
    expect(resolveScanConcurrency(Number.NaN)).toBe(MIN_SCAN_CONCURRENCY);
    expect(resolveScanConcurrency(Number.POSITIVE_INFINITY)).toBe(MIN_SCAN_CONCURRENCY);
  });
});
