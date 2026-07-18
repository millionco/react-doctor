import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noGlobalCssVariableAnimation } from "./no-global-css-variable-animation.js";

describe("performance/no-global-css-variable-animation — regressions", () => {
  it("flags setProperty of a CSS variable inside a requestAnimationFrame callback", () => {
    const result = runRule(
      noGlobalCssVariableAnimation,
      `requestAnimationFrame(() => {
  document.documentElement.style.setProperty("--scroll", String(window.scrollY));
});`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags transparent wrappers around the document root style", () => {
    const result = runRule(
      noGlobalCssVariableAnimation,
      `requestAnimationFrame(() => {
  (document.documentElement.style as any).setProperty("--scroll", String(window.scrollY));
  document.body.style!.setProperty("--progress", String(progress));
});`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("stays silent when the property set is not a CSS variable", () => {
    const result = runRule(
      noGlobalCssVariableAnimation,
      `requestAnimationFrame(() => {
  element.style.setProperty("opacity", "0.5");
});`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent for a CSS variable scoped to one element", () => {
    const result = runRule(
      noGlobalCssVariableAnimation,
      `requestAnimationFrame(() => {
  element.style.setProperty("--progress", String(progress));
});`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when document is shadowed", () => {
    const result = runRule(
      noGlobalCssVariableAnimation,
      `const document = model; requestAnimationFrame(() => document.body.style.setProperty("--x", "1"));`,
    );
    expect(result.diagnostics).toEqual([]);
  });
});
