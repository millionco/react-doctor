import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noLoadingFlagResetOutsideFinally } from "./no-loading-flag-reset-outside-finally.js";

describe("exceptional loading reset parity", () => {
  it.each([
    ["finally", "notify?.(false);", 0],
    ["catch", "notify?.(false);", 1],
    ["finally", 'throw new Error("failed");', 1],
    ["finally", "const resource = new Resource();", 1],
  ])("preserves %s reset protection after %s", (clause, operation, expectedCount) => {
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `export async function save() {
        setLoading(true);
        try { await request(); } ${clause} { ${operation} setLoading(false); }
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expectedCount);
  });
});
