import { describe, expect, it } from "vite-plus/test";
import { runPoolTimingProbe } from "./_pool-timing-helpers.js";

process.env.REACT_DOCTOR_DEBUG_NO_WORKER_FLAGS = "1";

describe("pool timing probe (worker pool, no node flags)", () => {
  it("records timings", { timeout: 120_000 }, async () => {
    await runPoolTimingProbe("noflags");
    expect(true).toBe(true);
  });
});
