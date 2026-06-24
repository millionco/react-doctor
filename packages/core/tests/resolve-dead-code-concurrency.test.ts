import { describe, expect, it } from "vite-plus/test";
import { resolveDeadCodeConcurrency } from "../src/utils/resolve-dead-code-concurrency.js";

const GIB = 1024 * 1024 * 1024;

describe("resolveDeadCodeConcurrency", () => {
  it("is core-bound when memory is plentiful", () => {
    // floor(64 GiB / 2 GiB) = 32 workers fit, so the 8 cores bind.
    expect(
      resolveDeadCodeConcurrency({
        availableCores: 8,
        totalMemoryBytes: 64 * GIB,
        cgroupMemoryLimitBytes: undefined,
      }),
    ).toBe(8);
  });

  it("keeps full project-level parallelism on a roomy dev box (10 cores / 16 GiB)", () => {
    // floor(16 / 2) = 8 ≥ the 4 projects scanned concurrently, so every project
    // still spawns its own worker — no serialization vs the prior uncapped path.
    expect(
      resolveDeadCodeConcurrency({
        availableCores: 10,
        totalMemoryBytes: 16 * GIB,
        cgroupMemoryLimitBytes: undefined,
      }),
    ).toBe(8);
  });

  it("collapses toward serial on a memory-starved runner", () => {
    // floor(3 GiB / 2 GiB) = 1 — a small CI runner serializes the spawns through
    // one slot instead of oversubscribing memory with N simultaneous children.
    expect(
      resolveDeadCodeConcurrency({
        availableCores: 8,
        totalMemoryBytes: 3 * GIB,
        cgroupMemoryLimitBytes: undefined,
      }),
    ).toBe(1);
  });

  it("honors a cgroup memory limit below the host total", () => {
    // The container sees 200 GiB of HOST memory but its cgroup caps it at 4 GiB
    // → floor(4 / 2) = 2.
    expect(
      resolveDeadCodeConcurrency({
        availableCores: 64,
        totalMemoryBytes: 200 * GIB,
        cgroupMemoryLimitBytes: 4 * GIB,
      }),
    ).toBe(2);
  });

  it("never drops below one worker", () => {
    expect(
      resolveDeadCodeConcurrency({
        availableCores: 8,
        totalMemoryBytes: 512 * 1024 * 1024,
        cgroupMemoryLimitBytes: undefined,
      }),
    ).toBe(1);
  });

  it("returns a positive integer on the real system", () => {
    const resolved = resolveDeadCodeConcurrency();
    expect(Number.isInteger(resolved)).toBe(true);
    expect(resolved).toBeGreaterThanOrEqual(1);
  });
});
