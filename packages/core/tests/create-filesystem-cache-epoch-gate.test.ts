import { describe, expect, it } from "vite-plus/test";
import { createFilesystemCacheEpochGate } from "../src/utils/create-filesystem-cache-epoch-gate.js";

describe("createFilesystemCacheEpochGate", () => {
  it("resets before the first job and keeps caches across jobs of one epoch", () => {
    const gate = createFilesystemCacheEpochGate();
    expect(gate.shouldReset(1)).toBe(true);
    expect(gate.shouldReset(1)).toBe(false);
    expect(gate.shouldReset(1)).toBe(false);
  });

  it("resets when the epoch changes", () => {
    const gate = createFilesystemCacheEpochGate();
    expect(gate.shouldReset(1)).toBe(true);
    expect(gate.shouldReset(2)).toBe(true);
    expect(gate.shouldReset(2)).toBe(false);
    expect(gate.shouldReset(1)).toBe(true);
  });

  it("always resets for jobs without an epoch and forgets the previous one", () => {
    const gate = createFilesystemCacheEpochGate();
    expect(gate.shouldReset(1)).toBe(true);
    expect(gate.shouldReset(null)).toBe(true);
    expect(gate.shouldReset(null)).toBe(true);
    expect(gate.shouldReset(1)).toBe(true);
  });
});
