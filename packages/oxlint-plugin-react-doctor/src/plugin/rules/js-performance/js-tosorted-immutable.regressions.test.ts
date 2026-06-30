import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { jsTosortedImmutable } from "./js-tosorted-immutable.js";

const expectFail = (code: string): void => {
  const result = runRule(jsTosortedImmutable, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics.length).toBeGreaterThan(0);
};

const expectPass = (code: string): void => {
  const result = runRule(jsTosortedImmutable, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toHaveLength(0);
};

describe("js-performance/js-tosorted-immutable — regressions", () => {
  it("flags `[...arr].sort()` on a reused array binding", () => {
    expectFail(`const arr = getItems();\nconst s = [...arr].sort();`);
  });

  it("does not flag spreading a freshly constructed `new Set(...)`", () => {
    expectPass(`const s = [...new Set(ids)].sort();`);
  });
});
