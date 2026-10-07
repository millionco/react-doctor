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

  it("flags braced currentColor string literals", () => {
    const code = `const A = () => <svg fill={'currentColor'} className="fill-zinc-400" />;`;
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

  it("does NOT flag leading-dot stroke width `stroke-[.5]`", () => {
    const code = `const A = () => <svg stroke="currentColor" className="stroke-[.5]" />;`;
    const result = runRule(noSvgCurrentcolorWithFillClass, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag non-color fill and stroke utilities", () => {
    const code = `const A = () => (
      <>
        <svg fill="currentColor" className="fill-none fill-rule-evenodd fill-opacity-50" />
        <svg stroke="currentColor" className="stroke-none stroke-linecap-round stroke-linejoin-round stroke-opacity-50" />
      </>
    );`;
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

  it("does NOT flag arbitrary currentColor or none paint values", () => {
    const code = `const A = () => <><svg fill="currentColor" className="fill-[currentColor]" /><svg stroke="currentColor" className="stroke-[NONE]" /><svg fill="currentColor" className="fill-[#ef4444]" /></>;`;
    const result = runRule(noSvgCurrentcolorWithFillClass, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does NOT flag a `fill-*` class with no currentColor attribute", () => {
    const code = `const A = () => <svg className="fill-zinc-400" />;`;
    const result = runRule(noSvgCurrentcolorWithFillClass, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT treat arbitrary-value fragments as paint utilities", () => {
    const code = `const A = () => <svg fill="currentColor" className="[--paint:x fill-red-500 y]" />;`;
    const result = runRule(noSvgCurrentcolorWithFillClass, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("keeps conflicting paint utilities and important non-color resets quiet", () => {
    const code = `const A = () => <><svg fill="currentColor" className="fill-red-500 fill-blue-500" /><svg stroke="currentColor" className="stroke-green-500 !stroke-none" /></>;`;
    const result = runRule(noSvgCurrentcolorWithFillClass, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("reports an important paint color over a normal reset", () => {
    const code = `const A = () => <svg fill="currentColor" className="!fill-red-500 fill-none" />;`;
    const result = runRule(noSvgCurrentcolorWithFillClass, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it('does NOT flag `fill="currentColor"` with no color class', () => {
    const code = `const A = () => <svg fill="currentColor" className="size-4 shrink-0" />;`;
    const result = runRule(noSvgCurrentcolorWithFillClass, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag custom components with paint-like props", () => {
    const code = `const A = () => <Icon fill="currentColor" className="fill-zinc-400" />;`;
    const result = runRule(noSvgCurrentcolorWithFillClass, code);
    expect(result.diagnostics).toHaveLength(0);
  });
});
