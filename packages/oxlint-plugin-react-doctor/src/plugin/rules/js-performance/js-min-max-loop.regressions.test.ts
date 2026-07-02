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

const expectSuggests = (code: string, mathFn: "min" | "max"): void => {
  const result = runRule(jsMinMaxLoop, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toHaveLength(1);
  expect(result.diagnostics[0].message).toContain(`Math.${mathFn}(...array)`);
};

describe("js-performance/js-min-max-loop — regressions", () => {
  it("flags `.sort((a, b) => a - b)[0]` with the canonical numeric comparator", () => {
    expectFail(`const smallest = nums.sort((a, b) => a - b)[0];`);
  });

  it("does not flag a comparator-less lexicographic `.sort()[0]`", () => {
    expectPass(`const first = [...names].sort()[0];`);
  });

  // Bugbot: the rewrite hint has to follow the sort direction. Ascending puts
  // the min at [0]; descending puts the max there.
  it("suggests Math.min for ascending `[0]` and Math.max for ascending `[length-1]`", () => {
    expectSuggests(`const smallest = nums.sort((a, b) => a - b)[0];`, "min");
    expectSuggests(`const largest = nums.sort((a, b) => a - b)[nums.length - 1];`, "max");
  });

  it("suggests Math.max for descending `[0]` and Math.min for descending `[length-1]`", () => {
    expectSuggests(`const largest = nums.sort((a, b) => b - a)[0];`, "max");
    expectSuggests(`const smallest = nums.sort((a, b) => b - a)[nums.length - 1];`, "min");
  });

  // fp-review PR #994: oxc-parser wraps `(a - b)` in a ParenthesizedExpression,
  // which must be peeled before matching the canonical comparator.
  it("flags the parenthesized concise-body comparator `(a, b) => (a - b)`", () => {
    expectSuggests(`const smallest = nums.sort((a, b) => (a - b))[0];`, "min");
  });

  it("flags the parenthesized block-body comparator `{ return (a - b); }`", () => {
    expectSuggests(`const smallest = nums.sort((a, b) => { return (a - b); })[0];`, "min");
  });

  it("flags the parenthesized descending comparator `(a, b) => (b - a)`", () => {
    expectSuggests(`const largest = nums.sort((a, b) => (b - a))[0];`, "max");
  });

  it("does not flag a derived-key comparator on objects", () => {
    expectPass(`const firstMatch = distance.sort((a, b) => a.dist - b.dist)[0];`);
  });

  it("does not flag a conditional-expression comparator", () => {
    expectPass(
      `const link = blogList.sort((a, b) => (a.frontmatter?.date > b.frontmatter?.date ? -1 : 1))[0].link;`,
    );
  });
});
