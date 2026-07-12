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
  it("flags a fresh finite numeric array sorted with the canonical comparator", () => {
    expectFail(`const smallest = [3, 1, 2].sort((a, b) => a - b)[0];`);
  });

  it("does not flag a comparator-less lexicographic `.sort()[0]`", () => {
    expectPass(`const first = [...names].sort()[0];`);
  });

  it("suggests Math.min for ascending `[0]`", () => {
    expectSuggests(`const smallest = [3, 1, 2].sort((a, b) => a - b)[0];`, "min");
  });

  it("suggests Math.max for descending `[0]`", () => {
    expectSuggests(`const largest = [-3, +1, 2].sort((a, b) => b - a)[0];`, "max");
  });

  // fp-review PR #994: oxc-parser wraps `(a - b)` in a ParenthesizedExpression,
  // which must be peeled before matching the canonical comparator.
  it("flags the parenthesized concise-body comparator `(a, b) => (a - b)`", () => {
    expectSuggests(`const smallest = [3, 1, 2].sort((a, b) => (a - b))[0];`, "min");
  });

  it("flags the parenthesized block-body comparator `{ return (a - b); }`", () => {
    expectSuggests(`const smallest = [3, 1, 2].sort((a, b) => { return (a - b); })[0];`, "min");
  });

  it("flags the parenthesized descending comparator `(a, b) => (b - a)`", () => {
    expectSuggests(`const largest = [3, 1, 2].sort((a, b) => (b - a))[0];`, "max");
  });

  it.each([
    `const smallest = nums.sort((a, b) => a - b)[0];`,
    `const smallest = [].sort((a, b) => a - b)[0];`,
    `const smallest = [, 1, 2].sort((a, b) => a - b)[0];`,
    `const smallest = [...nums].sort((a, b) => a - b)[0];`,
    `const smallest = [NaN, 1, 2].sort((a, b) => a - b)[0];`,
    `const smallest = [Infinity, 1, 2].sort((a, b) => a - b)[0];`,
    `const smallest = [undefined, 1, 2].sort((a, b) => a - b)[0];`,
    `const smallest = ["1", 2, 3].sort((a, b) => a - b)[0];`,
    `const smallest = [0, -0, 1].sort((a, b) => a - b)[0];`,
    `const largest = [3, 1, 2].sort((a, b) => a - b)[2];`,
  ])("does not recommend Math.min/max when scalar equivalence is unproven", (code) => {
    expectPass(code);
  });

  it("does not flag a magnitude comparator", () => {
    expectPass(
      `const smallestMagnitude = [3, -1, 2].sort((a, b) => Math.abs(a) - Math.abs(b))[0];`,
    );
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
