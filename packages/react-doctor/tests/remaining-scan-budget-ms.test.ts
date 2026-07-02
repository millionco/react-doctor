import { describe, expect, it } from "vite-plus/test";
import { MIN_REMAINING_SCAN_BUDGET_MS } from "../src/cli/utils/constants.js";
import { remainingScanBudgetMs } from "../src/cli/utils/remaining-scan-budget-ms.js";

describe("remainingScanBudgetMs", () => {
  it("returns undefined when no deadline was set", () => {
    expect(remainingScanBudgetMs(null)).toBeUndefined();
  });

  it("returns the budget remaining until the deadline", () => {
    const remainingMs = remainingScanBudgetMs(Date.now() + 5_000);
    expect(remainingMs).toBeGreaterThan(4_000);
    expect(remainingMs).toBeLessThanOrEqual(5_000);
  });

  it("floors a spent budget so the scan still degrades gracefully", () => {
    expect(remainingScanBudgetMs(Date.now() - 10_000)).toBe(MIN_REMAINING_SCAN_BUDGET_MS);
  });
});
