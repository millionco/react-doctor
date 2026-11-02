import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { jsMinMaxLoop } from "./js-min-max-loop.js";

describe("js-min-max-loop parameter property bindings", () => {
  it.each([
    `export {}; class Picker { constructor(public Math: { min(...values: number[]): number }, value = [3, 1, 2].sort((left, right) => left - right)[0]) {} }`,
    `export {}; class Picker { constructor(private readonly Math: { min(...values: number[]): number }) { const value = [3, 1, 2].sort((left, right) => left - right)[0]; } }`,
    `export {}; class Picker { constructor(protected Math = { min: (...values: number[]) => 99 }, value = [3, 1, 2].sort((left, right) => left - right)[0]) {} }`,
    `export {}; class Picker { constructor(public Math: { min(...values: number[]): number }, { value = [3, 1, 2].sort((left, right) => left - right)[0] }: { value?: number } = {}) {} }`,
    `export {}; class Picker { constructor(public Math: { min(...values: number[]): number }, { [[3, 1, 2].sort((left, right) => left - right)[0]]: value }: Record<number, number>) {} }`,
    `export {}; class Base {} class Picker extends Base { constructor(public Math: { min(...values: number[]): number }, value = [3, 1, 2].sort((left, right) => left - right)[0]) { super(); } }`,
    `export {}; const Math = { min: (...values: number[]) => 99 }; class Picker { constructor(public value = [3, 1, 2].sort((left, right) => left - right)[0]) { const Math = globalThis.Math; } }`,
  ])("keeps recommendations quiet for a custom parameter provider", (source) => {
    const result = runRule(jsMinMaxLoop, source, { filename: "fixture.ts" });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    `export {}; class Picker { constructor(public math: { min(...values: number[]): number }, value = [3, 1, 2].sort((left, right) => left - right)[0]) {} }`,
    `export {}; class Picker { constructor(public value = [3, 1, 2].sort((left, right) => left - right)[0]) { const Math = { min: (...values: number[]) => 99 }; } }`,
    `export {}; class Picker { constructor(public math = globalThis.Math) { const value = [3, 1, 2].sort((left, right) => left - right)[0]; } }`,
    `export {}; class Base {} class Picker extends Base { constructor(public value = [3, 1, 2].sort((left, right) => left - right)[0]) { super(); } }`,
  ])("preserves recommendations for the native provider", (source) => {
    const result = runRule(jsMinMaxLoop, source, { filename: "fixture.ts" });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("Math.min(...array)");
  });
});
