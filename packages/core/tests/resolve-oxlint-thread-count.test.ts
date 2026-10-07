import { describe, expect, it } from "vite-plus/test";
import { MIN_OXLINT_THREADS_PER_WORKER } from "../src/constants.js";
import { resolveOxlintThreadCount } from "../src/utils/resolve-oxlint-thread-count.js";

describe("resolveOxlintThreadCount", () => {
  it("shares the cores across workers", () => {
    expect(resolveOxlintThreadCount(8, 8)).toBe(1);
    expect(resolveOxlintThreadCount(4, 8)).toBe(2);
    expect(resolveOxlintThreadCount(1, 8)).toBe(8);
  });

  it("floors fractional shares", () => {
    expect(resolveOxlintThreadCount(3, 8)).toBe(2);
  });

  it("never drops below the per-worker floor when workers exceed cores", () => {
    expect(resolveOxlintThreadCount(10, 8)).toBe(MIN_OXLINT_THREADS_PER_WORKER);
    expect(resolveOxlintThreadCount(32, 4)).toBe(MIN_OXLINT_THREADS_PER_WORKER);
  });
});
