import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noSvgCurrentcolorWithFillClass } from "./no-svg-currentcolor-with-fill-class.js";

describe("no-svg-currentcolor-with-fill-class", () => {
  it('flags `fill="currentColor"` with a `fill-zinc-400` class', () => {
    const code = `const A = () => <svg fill="currentColor" className="fill-zinc-400" />;`;
    const result = runRule(noSvgCurrentcolorWithFillClass, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it('flags `stroke="currentColor"` with a `stroke-blue-500` class', () => {
    const code = `const A = () => <svg stroke="currentColor" className="stroke-blue-500" />;`;
    const result = runRule(noSvgCurrentcolorWithFillClass, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does NOT flag stroke-width utilities like `stroke-2` (Bugbot: width is not color)", () => {
    const code = `const A = () => <svg stroke="currentColor" className="stroke-2" />;`;
    const result = runRule(noSvgCurrentcolorWithFillClass, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag arbitrary stroke width `stroke-[1.5]`", () => {
    const code = `const A = () => <svg stroke="currentColor" className="stroke-[1.5]" />;`;
    const result = runRule(noSvgCurrentcolorWithFillClass, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags a stroke COLOR alongside a width (`stroke-2 stroke-red-500`)", () => {
    const code = `const A = () => <svg stroke="currentColor" className="stroke-2 stroke-red-500" />;`;
    const result = runRule(noSvgCurrentcolorWithFillClass, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does NOT flag a variant-prefixed `hover:fill-blue-600` (no static base conflict)", () => {
    const code = `const A = () => <svg fill="currentColor" className="hover:fill-blue-600" />;`;
    const result = runRule(noSvgCurrentcolorWithFillClass, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag `dark:fill-white` with currentColor (state-gated)", () => {
    const code = `const A = () => <svg fill="currentColor" className="dark:fill-white" />;`;
    const result = runRule(noSvgCurrentcolorWithFillClass, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag `fill-current` (intended to inherit)", () => {
    const code = `const A = () => <svg fill="currentColor" className="fill-current" />;`;
    const result = runRule(noSvgCurrentcolorWithFillClass, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag a `fill-*` class with no currentColor attribute", () => {
    const code = `const A = () => <svg className="fill-zinc-400" />;`;
    const result = runRule(noSvgCurrentcolorWithFillClass, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it('does NOT flag `fill="currentColor"` with no color class', () => {
    const code = `const A = () => <svg fill="currentColor" className="size-4 shrink-0" />;`;
    const result = runRule(noSvgCurrentcolorWithFillClass, code);
    expect(result.diagnostics).toHaveLength(0);
  });
});
