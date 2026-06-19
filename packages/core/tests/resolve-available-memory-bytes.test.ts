import os from "node:os";
import { describe, expect, it } from "vite-plus/test";
import { resolveAvailableMemoryBytes } from "../src/utils/resolve-available-memory-bytes.js";

describe("resolveAvailableMemoryBytes", () => {
  it("returns a positive, finite byte count on this platform (no throw on any reader path)", () => {
    const bytes = resolveAvailableMemoryBytes();
    expect(Number.isFinite(bytes)).toBe(true);
    expect(bytes).toBeGreaterThan(0);
  });

  it("never exceeds total system memory (available pages + cgroup cap are both <= total)", () => {
    expect(resolveAvailableMemoryBytes()).toBeLessThanOrEqual(os.totalmem());
  });
});
