import { describe, expect, it } from "vite-plus/test";
import { resolveProjectAnalysisConcurrency } from "../src/utils/resolve-project-analysis-concurrency.js";

const GIB = 1024 * 1024 * 1024;
const MIB = 1024 * 1024;

describe("resolveProjectAnalysisConcurrency", () => {
  it("is core-bound when memory is plentiful", () => {
    expect(
      resolveProjectAnalysisConcurrency({
        availableCores: 8,
        totalMemoryBytes: 64 * GIB,
        cgroupMemoryLimitBytes: undefined,
      }),
    ).toBe(8);
  });

  it("is memory-bound on a constrained host", () => {
    expect(
      resolveProjectAnalysisConcurrency({
        availableCores: 32,
        totalMemoryBytes: 6 * GIB,
        cgroupMemoryLimitBytes: undefined,
      }),
    ).toBe(3);
  });

  it("honors a cgroup memory limit below the host total", () => {
    expect(
      resolveProjectAnalysisConcurrency({
        availableCores: 32,
        totalMemoryBytes: 128 * GIB,
        cgroupMemoryLimitBytes: 4 * GIB,
      }),
    ).toBe(2);
  });

  it("always permits one worker", () => {
    expect(
      resolveProjectAnalysisConcurrency({
        availableCores: 8,
        totalMemoryBytes: 512 * MIB,
        cgroupMemoryLimitBytes: undefined,
      }),
    ).toBe(1);
  });

  it("returns a positive integer on the current system", () => {
    const concurrency = resolveProjectAnalysisConcurrency();
    expect(Number.isInteger(concurrency)).toBe(true);
    expect(concurrency).toBeGreaterThanOrEqual(1);
  });
});
