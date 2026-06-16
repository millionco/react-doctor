import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noArbitraryPxFontSize } from "./no-arbitrary-px-font-size.js";

describe("no-arbitrary-px-font-size", () => {
  it("flags `text-[13px]` and suggests rem", () => {
    const code = `const A = () => <p className="text-[13px]">x</p>;`;
    const result = runRule(noArbitraryPxFontSize, code);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("0.8125rem");
  });

  it("flags `text-[13px]/5` (with line-height suffix)", () => {
    const code = `const A = () => <p className="text-[13px]/5">x</p>;`;
    const result = runRule(noArbitraryPxFontSize, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a variant-prefixed `sm:text-[15px]`", () => {
    const code = `const A = () => <p className="sm:text-[15px]">x</p>;`;
    const result = runRule(noArbitraryPxFontSize, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does NOT flag `text-[0.8125rem]`", () => {
    const code = `const A = () => <p className="text-[0.8125rem]">x</p>;`;
    const result = runRule(noArbitraryPxFontSize, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag named sizes like `text-sm`", () => {
    const code = `const A = () => <p className="text-sm">x</p>;`;
    const result = runRule(noArbitraryPxFontSize, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag pixel borders/outlines (`border-[1px]`)", () => {
    const code = `const A = () => <div className="border-[1px] outline-[2px]" />;`;
    const result = runRule(noArbitraryPxFontSize, code);
    expect(result.diagnostics).toHaveLength(0);
  });
});
