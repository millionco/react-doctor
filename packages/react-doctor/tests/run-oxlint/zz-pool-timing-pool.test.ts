import { describe, expect, it } from "vite-plus/test";
import { runPoolTimingProbe } from "./_pool-timing-helpers.js";

describe("pool timing probe (worker pool)", () => {
  it("records timings", { timeout: 120_000 }, async () => {
    await runPoolTimingProbe("pool");
    expect(true).toBe(true);
  });
});
