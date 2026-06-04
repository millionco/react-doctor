import { describe, expect, it } from "vite-plus/test";
import { recordCount, recordDistribution } from "../src/cli/utils/record-metric.js";

// Under tests the CLI never initializes Sentry (see `instrument.ts`), so every
// emit helper must be an inert no-op rather than throwing into the caller's path.
describe("record-metric (no active Sentry client)", () => {
  it("recordCount does not throw and returns void", () => {
    expect(recordCount("cli.invoked", 1, { command: "inspect", ciProvider: null })).toBeUndefined();
    expect(() => recordCount("scan.completed")).not.toThrow();
  });

  it("recordDistribution does not throw", () => {
    expect(() =>
      recordDistribution("scan.duration", 123.4, {
        unit: "millisecond",
        attributes: { mode: "full" },
      }),
    ).not.toThrow();
  });
});
