import { describe, expect, it } from "vite-plus/test";
import { MATH_EXTREMUM_SPREAD_MAX_ELEMENT_COUNT } from "../../constants/thresholds.js";
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

  it.each([
    `const smallest = (([+3, -1, 2] as number[])).sort((a, b) => a - b)[0];`,
    `const smallest = [(3 as number), (1 satisfies number), -2].sort((a, b) => a - b)[0];`,
    `const smallest = [-(-3), +(+1), 2].sort((a, b) => ((a - b) as number))[0];`,
    `const smallest = [-0, -0].sort((a, b) => a - b)[0];`,
    `interface Math {} const smallest = [3, 1, 2].sort((a, b) => a - b)[0];`,
    `const Math = globalThis.Math; const smallest = [3, 1, 2].sort((a, b) => a - b)[0];`,
    `const Array = class UserlandArray {}; const smallest = [3, 1, 2].sort((a, b) => a - b)[0];`,
    `globalThis.Array = class UserlandArray extends globalThis.Array {}; const smallest = [3, 1, 2].sort((a, b) => a - b)[0];`,
  ])("flags transparent and shadowing-safe fresh numeric arrays", (code) => {
    expectFail(code);
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
    "const smallest = [`1`, 2, 3].sort((a, b) => a - b)[0];",
    `const smallest = [1n, 2n, 3n].sort((a, b) => a - b)[0];`,
    `const smallest = [{ valueOf: () => 1 }, 2, 3].sort((a, b) => a - b)[0];`,
    `const smallest = [+Infinity, 1, 2].sort((a, b) => a - b)[0];`,
    `const smallest = [-NaN, 1, 2].sort((a, b) => a - b)[0];`,
    `const smallest = [0, -0, 1].sort((a, b) => a - b)[0];`,
    `const largest = [3, 1, 2].sort((a, b) => a - b)[2];`,
    `const largest = [3, 1, 2].sort((a, b) => a - b)[-0];`,
    `const largest = [3, 1, 2].sort((a, b) => a - b)[+0];`,
    `const largest = [3, 1, 2].sort((a, b) => a - b)["0"];`,
    `const largest = [3, 1, 2].sort((a, b) => a - b)[nums.length - 1];`,
    `const smallest = [3, 1, 2].sort(async (a, b) => a - b)[0];`,
    `const smallest = [3, 1, 2].sort(async function (a, b) { return a - b; })[0];`,
    `const smallest = [3, 1, 2].sort(function* (a, b) { return a - b; })[0];`,
    `const smallest = [3, 1, 2].sort(function (a, a) { return a - a; })[0];`,
  ])("does not recommend Math.min/max when scalar equivalence is unproven", (code) => {
    expectPass(code);
  });

  it("does not flag a literal large enough to risk an argument-limit failure", () => {
    const elements = Array.from(
      { length: MATH_EXTREMUM_SPREAD_MAX_ELEMENT_COUNT + 1 },
      (_, index) => index,
    ).join(",");
    expectPass(`const smallest = [${elements}].sort((a, b) => a - b)[0];`);
  });

  it("still flags a literal at the conservative spread limit", () => {
    const elements = Array.from(
      { length: MATH_EXTREMUM_SPREAD_MAX_ELEMENT_COUNT },
      (_, index) => index,
    ).join(",");
    expectFail(`const smallest = [${elements}].sort((a, b) => a - b)[0];`);
  });

  it.each([
    `function f(Math){ return [3, 1, 2].sort((a, b) => a - b)[0]; }`,
    `const Math = { min: () => 99 }; const smallest = [3, 1, 2].sort((a, b) => a - b)[0];`,
    `Math.min = () => 99; const smallest = [3, 1, 2].sort((a, b) => a - b)[0];`,
    `const mathAlias = Math; mathAlias.min = () => 99; const smallest = [3, 1, 2].sort((a, b) => a - b)[0];`,
    `const methodName = "min"; Math[methodName] = () => 99; const smallest = [3, 1, 2].sort((a, b) => a - b)[0];`,
    `Object.defineProperty(Math, "min", { value: () => 99 }); const smallest = [3, 1, 2].sort((a, b) => a - b)[0];`,
    `const defineProperty = Object.defineProperty; defineProperty(Math, "min", { value: () => 99 }); const smallest = [3, 1, 2].sort((a, b) => a - b)[0];`,
    `globalThis.Math = { ...Math, min: () => 99 }; const smallest = [3, 1, 2].sort((a, b) => a - b)[0];`,
    `global.Math.min = () => 99; const smallest = [3, 1, 2].sort((a, b) => a - b)[0];`,
    `const globalAlias = globalThis; globalAlias.Math = { ...Math, min: () => 99 }; const smallest = [3, 1, 2].sort((a, b) => a - b)[0];`,
    `Object.defineProperty(globalThis, "Math", { value: { min: () => 99 } }); const smallest = [3, 1, 2].sort((a, b) => a - b)[0];`,
    `Object.assign(globalThis, { Math: { min: () => 99 } }); const smallest = [3, 1, 2].sort((a, b) => a - b)[0];`,
    `Array.prototype.sort = () => [99]; const smallest = [3, 1, 2].sort((a, b) => a - b)[0];`,
    `const methodName = "sort"; Array.prototype[methodName] = () => [99]; const smallest = [3, 1, 2].sort((a, b) => a - b)[0];`,
    `const arrayPrototype = Array.prototype; arrayPrototype.sort = () => [99]; const smallest = [3, 1, 2].sort((a, b) => a - b)[0];`,
    `Object.defineProperty(Array.prototype, "sort", { value: () => [99] }); const smallest = [3, 1, 2].sort((a, b) => a - b)[0];`,
    `Reflect.set(globalThis.Array.prototype, "sort", () => [99]); const smallest = [3, 1, 2].sort((a, b) => a - b)[0];`,
    `delete Array.prototype.sort; const smallest = [3, 1, 2].sort((a, b) => a - b)[0];`,
    `Object.defineProperties(Array.prototype, { sort: { value: () => [99] } }); const smallest = [3, 1, 2].sort((a, b) => a - b)[0];`,
    `Object.assign(Array.prototype, { filter() {} }, { sort() { return [99]; } }); const smallest = [3, 1, 2].sort((a, b) => a - b)[0];`,
    `Object.assign(Array.prototype, { ["so" + "rt"]() { return [99]; } }); const smallest = [3, 1, 2].sort((a, b) => a - b)[0];`,
    `Reflect.deleteProperty(Math, "min"); const smallest = [3, 1, 2].sort((a, b) => a - b)[0];`,
    `window.Math.min = () => 99; const smallest = [3, 1, 2].sort((a, b) => a - b)[0];`,
    `Object.assign(Array.prototype, { filter() {}, sort() { return [99]; } }); const smallest = [3, 1, 2].sort((a, b) => a - b)[0];`,
    `const arrayPrototype = [].__proto__; arrayPrototype.sort = () => [99]; const smallest = [3, 1, 2].sort((a, b) => a - b)[0];`,
    `const arrayPrototype = Object.getPrototypeOf([]); arrayPrototype.sort = () => [99]; const smallest = [3, 1, 2].sort((a, b) => a - b)[0];`,
    `const arrayPrototype = Reflect.getPrototypeOf([]); arrayPrototype.sort = () => [99]; const smallest = [3, 1, 2].sort((a, b) => a - b)[0];`,
    `Math.min++; const smallest = [3, 1, 2].sort((a, b) => a - b)[0];`,
    `self.Math.min = () => 99; const smallest = [3, 1, 2].sort((a, b) => a - b)[0];`,
    `const methodName = pickMethod(); Object.defineProperty(Math, methodName, { value: () => 99 }); const smallest = [3, 1, 2].sort((a, b) => a - b)[0];`,
    `let Math = globalThis.Math; const smallest = [3, 1, 2].sort((a, b) => a - b)[0];`,
    `var Math = globalThis.Math; const smallest = [3, 1, 2].sort((a, b) => a - b)[0];`,
    `class Math {} const smallest = [3, 1, 2].sort((a, b) => a - b)[0];`,
    `import Math from "./userland-math.js"; const smallest = [3, 1, 2].sort((a, b) => a - b)[0];`,
  ])("does not recommend a shadowed or mutated Math/Array builtin", (code) => {
    expectPass(code);
  });

  it.each([
    `Math.max = () => 99; const smallest = [3, 1, 2].sort((a, b) => a - b)[0];`,
    `Math.min = () => 99; const largest = [3, 1, 2].sort((a, b) => b - a)[0];`,
    `Math.round = () => 99; const smallest = [3, 1, 2].sort((a, b) => a - b)[0];`,
    `Array.prototype.filter = () => []; const smallest = [3, 1, 2].sort((a, b) => a - b)[0];`,
    `Object.defineProperty(Array.prototype, "filter", { value: () => [] }); const smallest = [3, 1, 2].sort((a, b) => a - b)[0];`,
    `Object.assign(Array.prototype, { filter() {} }, { map() {} }); const smallest = [3, 1, 2].sort((a, b) => a - b)[0];`,
    `Array.prototype["filter"] = () => []; const smallest = [3, 1, 2].sort((a, b) => a - b)[0];`,
    `const Array = class UserlandArray {}; Array.prototype.sort = () => [99]; const smallest = [3, 1, 2].sort((a, b) => a - b)[0];`,
    `function mutateUserland(){ const Math = { min: () => 99 }; Math.min = () => 0; } const smallest = [3, 1, 2].sort((a, b) => a - b)[0];`,
  ])("keeps reporting after unrelated or userland mutations", (code) => {
    expectFail(code);
  });

  it("reports every safe sort in a program through the per-program mutation-scan cache", () => {
    const result = runRule(
      jsMinMaxLoop,
      `const smallestLeft = [3, 1, 2].sort((a, b) => a - b)[0]; const smallestRight = [9, 8, 7].sort((a, b) => a - b)[0];`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
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
