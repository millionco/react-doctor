import { afterEach, describe, expect, it } from "vite-plus/test";
import { LINT_BATCH_CONCURRENCY_MAX, resolveLintConcurrency } from "@react-doctor/core";

const ENV_KEY = "REACT_DOCTOR_LINT_CONCURRENCY";
const originalOverride = process.env[ENV_KEY];

afterEach(() => {
  if (originalOverride === undefined) {
    delete process.env[ENV_KEY];
  } else {
    process.env[ENV_KEY] = originalOverride;
  }
});

describe("resolveLintConcurrency", () => {
  it("honors a valid numeric override", () => {
    process.env[ENV_KEY] = "3";
    expect(resolveLintConcurrency()).toBe(3);
  });

  it("forces sequential execution when the override is 1", () => {
    process.env[ENV_KEY] = "1";
    expect(resolveLintConcurrency()).toBe(1);
  });

  it("allows an override above the default cap (memory-rich runners)", () => {
    process.env[ENV_KEY] = String(LINT_BATCH_CONCURRENCY_MAX + 16);
    expect(resolveLintConcurrency()).toBe(LINT_BATCH_CONCURRENCY_MAX + 16);
  });

  it("floors a fractional override", () => {
    process.env[ENV_KEY] = "4.9";
    expect(resolveLintConcurrency()).toBe(4);
  });

  it("falls back to the derived default for non-numeric or sub-1 overrides", () => {
    for (const invalid of ["abc", "0", "-2", ""]) {
      process.env[ENV_KEY] = invalid;
      const resolved = resolveLintConcurrency();
      expect(resolved).toBeGreaterThanOrEqual(1);
      expect(resolved).toBeLessThanOrEqual(LINT_BATCH_CONCURRENCY_MAX);
    }
  });

  it("derives a default within [1, LINT_BATCH_CONCURRENCY_MAX] when no override is set", () => {
    delete process.env[ENV_KEY];
    const resolved = resolveLintConcurrency();
    expect(resolved).toBeGreaterThanOrEqual(1);
    expect(resolved).toBeLessThanOrEqual(LINT_BATCH_CONCURRENCY_MAX);
  });
});
