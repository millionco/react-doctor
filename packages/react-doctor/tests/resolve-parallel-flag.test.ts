import { describe, expect, it } from "vite-plus/test";
import { MAX_SCAN_CONCURRENCY, MIN_SCAN_CONCURRENCY } from "@react-doctor/core";
import { resolveParallelFlag } from "../src/cli/utils/resolve-parallel-flag.js";

describe("resolveParallelFlag", () => {
  it("returns undefined when the flag is absent (defers to env / serial default)", () => {
    expect(resolveParallelFlag(undefined)).toBeUndefined();
  });

  it("auto-detects cores for a bare --experimental-parallel, within [MIN, MAX]", () => {
    const resolved = resolveParallelFlag(true);
    expect(resolved).toBeGreaterThanOrEqual(MIN_SCAN_CONCURRENCY);
    expect(resolved).toBeLessThanOrEqual(MAX_SCAN_CONCURRENCY);
  });

  it("treats an explicit opt-out as serial so it overrides an env-enabled default", () => {
    // Regression: these used to return undefined (= flag-absent), which let
    // REACT_DOCTOR_PARALLEL win over an explicit `--experimental-parallel false / 0 / off`.
    expect(resolveParallelFlag(false)).toBe(MIN_SCAN_CONCURRENCY);
    expect(resolveParallelFlag("false")).toBe(MIN_SCAN_CONCURRENCY);
    expect(resolveParallelFlag("off")).toBe(MIN_SCAN_CONCURRENCY);
    expect(resolveParallelFlag("0")).toBe(MIN_SCAN_CONCURRENCY);
  });

  it("parses and clamps an explicit worker count", () => {
    expect(resolveParallelFlag("4")).toBe(4);
    expect(resolveParallelFlag("9999")).toBe(MAX_SCAN_CONCURRENCY);
  });

  it("auto-detects cores for auto / empty / unparseable values", () => {
    for (const value of ["auto", "", "garbage"]) {
      const resolved = resolveParallelFlag(value);
      expect(resolved).toBeGreaterThanOrEqual(MIN_SCAN_CONCURRENCY);
      expect(resolved).toBeLessThanOrEqual(MAX_SCAN_CONCURRENCY);
    }
  });
});
