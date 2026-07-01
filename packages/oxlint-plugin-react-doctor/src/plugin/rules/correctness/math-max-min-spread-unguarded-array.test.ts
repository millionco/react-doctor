import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { mathMaxMinSpreadUnguardedArray } from "./math-max-min-spread-unguarded-array.js";

describe("math-max-min-spread-unguarded-array", () => {
  it("flags Math.max spread of a bare variable", () => {
    const result = runRule(mathMaxMinSpreadUnguardedArray, `const m = Math.max(...heights);`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags Math.min spread of a mapped call result", () => {
    const result = runRule(
      mathMaxMinSpreadUnguardedArray,
      `const m = Math.min(...refs.map((r) => r.height));`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags Math.max spread of a member-expression array", () => {
    const result = runRule(mathMaxMinSpreadUnguardedArray, `const m = Math.max(...state.values);`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a non-empty literal array", () => {
    const result = runRule(mathMaxMinSpreadUnguardedArray, `const m = Math.max(...[1, 2, 3]);`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when a scalar default precedes the spread", () => {
    const result = runRule(mathMaxMinSpreadUnguardedArray, `const m = Math.max(0, ...arr);`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when a scalar default follows the spread", () => {
    const result = runRule(mathMaxMinSpreadUnguardedArray, `const m = Math.max(...arr, 0);`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a ternary guarded by arr.length", () => {
    const result = runRule(
      mathMaxMinSpreadUnguardedArray,
      `const m = arr.length > 0 ? Math.max(...arr) : fallback;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an && short-circuit length guard", () => {
    const result = runRule(
      mathMaxMinSpreadUnguardedArray,
      `const m = arr.length && Math.max(...arr);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an if-statement length guard", () => {
    const result = runRule(
      mathMaxMinSpreadUnguardedArray,
      `function f(arr) { if (arr.length > 0) { return Math.max(...arr); } return 0; }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a filtered array literal with a guaranteed element", () => {
    const result = runRule(
      mathMaxMinSpreadUnguardedArray,
      `const m = Math.max(...[minValue, value - n].filter(isNotUndefined));`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a filter chain on a variable", () => {
    const result = runRule(
      mathMaxMinSpreadUnguardedArray,
      `const m = Math.max(...items.filter(Boolean));`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag unrelated Math calls", () => {
    const result = runRule(mathMaxMinSpreadUnguardedArray, `const m = Math.round(value);`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag Math.max with plain scalar arguments", () => {
    const result = runRule(mathMaxMinSpreadUnguardedArray, `const m = Math.max(a, b);`);
    expect(result.diagnostics).toHaveLength(0);
  });
});
