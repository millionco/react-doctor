import { describe, expect, it } from "vite-plus/test";
import { runPoolTimingProbe } from "./_pool-timing-helpers.js";

process.env.REACT_DOCTOR_DISABLE_OXLINT_WORKER_POOL = "1";

describe("pool timing probe (legacy spawn)", () => {
  it("records timings", { timeout: 120_000 }, async () => {
    await runPoolTimingProbe("legacy");
    expect(true).toBe(true);
  });
});
