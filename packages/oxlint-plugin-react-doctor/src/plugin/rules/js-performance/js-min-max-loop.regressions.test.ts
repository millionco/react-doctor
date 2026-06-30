import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { jsMinMaxLoop } from "./js-min-max-loop.js";

const expectFail = (code: string): void => {
  const result = runRule(jsMinMaxLoop, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics.length).toBeGreaterThan(0);
};

const expectPass = (code: string): void => {
  const result = runRule(jsMinMaxLoop, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toHaveLength(0);
};

describe("js-performance/js-min-max-loop — regressions", () => {
  it("flags `.sort((a, b) => a - b)[0]` with the canonical numeric comparator", () => {
    expectFail(`const smallest = nums.sort((a, b) => a - b)[0];`);
  });

  it("does not flag a comparator-less lexicographic `.sort()[0]`", () => {
    expectPass(`const first = [...names].sort()[0];`);
  });
});
