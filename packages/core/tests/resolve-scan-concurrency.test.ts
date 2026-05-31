import { describe, expect, it } from "vite-plus/test";
import { MAX_SCAN_CONCURRENCY, MIN_SCAN_CONCURRENCY } from "../src/constants.js";
import { resolveScanConcurrency } from "../src/utils/resolve-scan-concurrency.js";

describe("resolveScanConcurrency", () => {
  it("passes through in-range integers unchanged", () => {
    expect(resolveScanConcurrency(4)).toBe(4);
    expect(resolveScanConcurrency(MIN_SCAN_CONCURRENCY)).toBe(MIN_SCAN_CONCURRENCY);
    expect(resolveScanConcurrency(MAX_SCAN_CONCURRENCY)).toBe(MAX_SCAN_CONCURRENCY);
  });

  it("clamps to MAX above the ceiling", () => {
    expect(resolveScanConcurrency(MAX_SCAN_CONCURRENCY + 100)).toBe(MAX_SCAN_CONCURRENCY);
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
  });

  it("resolves 'auto' to an integer within [MIN, MAX]", () => {
    const resolved = resolveScanConcurrency("auto");
    expect(Number.isInteger(resolved)).toBe(true);
    expect(resolved).toBeGreaterThanOrEqual(MIN_SCAN_CONCURRENCY);
    expect(resolved).toBeLessThanOrEqual(MAX_SCAN_CONCURRENCY);
  });
});
