import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noTailwindLayoutTransition } from "./no-tailwind-layout-transition.js";

describe("no-tailwind-layout-transition", () => {
  it("flags `transition-[height]`", () => {
    const code = `const A = () => <div className="transition-[height] duration-300" />;`;
    const result = runRule(noTailwindLayoutTransition, code);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("height");
  });

  it("flags `transition-[margin-top]`", () => {
    const code = `const A = () => <div className="transition-[margin-top]" />;`;
    const result = runRule(noTailwindLayoutTransition, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a layout property mixed with a safe one (`transition-[width,opacity]`)", () => {
    const code = `const A = () => <div className="transition-[width,opacity]" />;`;
    const result = runRule(noTailwindLayoutTransition, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does NOT flag SVG `transition-[stroke-width]` (not HTML layout)", () => {
    const code = `const A = () => <circle className="transition-[stroke-width]" />;`;
    const result = runRule(noTailwindLayoutTransition, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag `transition-[border-width]` (substring of a non-layout prop)", () => {
    const code = `const A = () => <div className="transition-[border-width]" />;`;
    const result = runRule(noTailwindLayoutTransition, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags `transition-[max-height]` (a real layout property)", () => {
    const code = `const A = () => <div className="transition-[max-height]" />;`;
    const result = runRule(noTailwindLayoutTransition, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does NOT flag `transition-[transform]`", () => {
    const code = `const A = () => <div className="transition-[transform] duration-300" />;`;
    const result = runRule(noTailwindLayoutTransition, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag `transition-[opacity,filter]`", () => {
    const code = `const A = () => <div className="transition-[opacity,filter]" />;`;
    const result = runRule(noTailwindLayoutTransition, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag the named `transition-transform` utility", () => {
    const code = `const A = () => <div className="transition-transform" />;`;
    const result = runRule(noTailwindLayoutTransition, code);
    expect(result.diagnostics).toHaveLength(0);
  });
});
