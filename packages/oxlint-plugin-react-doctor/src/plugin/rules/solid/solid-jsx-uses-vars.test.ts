import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { solidJsxUsesVars } from "./solid-jsx-uses-vars.js";

describe("solid-jsx-uses-vars", () => {
  it("reports undefined directive variable", () => {
    const result = runRule(solidJsxUsesVars, `const Comp = () => <div use:myDirective />;`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("myDirective");
    expect(result.diagnostics[0].message).toContain("not defined");
  });

  it("reports directive-only variable as potentially unused", () => {
    const result = runRule(
      solidJsxUsesVars,
      `const myDirective = (el) => { el.focus(); };
       const Comp = () => <div use:myDirective />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("only used as");
  });

  it("does not report directive variable that has other references", () => {
    const result = runRule(
      solidJsxUsesVars,
      `const myDirective = (el) => { el.focus(); };
       console.log(myDirective);
       const Comp = () => <div use:myDirective />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not report imported directive variable with other references", () => {
    const result = runRule(
      solidJsxUsesVars,
      `import { myDirective } from "./directives";
       export { myDirective };
       const Comp = () => <div use:myDirective />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("reports multiple undefined directive variables", () => {
    const result = runRule(solidJsxUsesVars, `const Comp = () => <div use:foo use:bar />;`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("does not report non-use namespaced attributes", () => {
    const result = runRule(solidJsxUsesVars, `const Comp = () => <div on:click={() => {}} />;`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not report regular JSX attributes", () => {
    const result = runRule(
      solidJsxUsesVars,
      `const Comp = () => <div class="foo" onClick={() => {}} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not report JSX component usage (handled by scope analysis natively)", () => {
    const result = runRule(
      solidJsxUsesVars,
      `const MyComp = () => <div />;
       const App = () => <MyComp />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("reports directive used on multiple elements when undefined", () => {
    const result = runRule(
      solidJsxUsesVars,
      `const Comp = () => <><div use:tooltip /><span use:tooltip /></>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("does not flag directive variable used in function call", () => {
    const result = runRule(
      solidJsxUsesVars,
      `const clickOutside = (el, accessor) => {};
       registerDirective(clickOutside);
       const Comp = () => <div use:clickOutside />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("handles use:directive with a value expression", () => {
    const result = runRule(
      solidJsxUsesVars,
      `const myDir = (el, accessor) => {};
       const Comp = () => <div use:myDir={someValue} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("only used as");
  });

  it("does not flag aliased import used as directive with other references", () => {
    const result = runRule(
      solidJsxUsesVars,
      `import { clickOutside as myDir } from "./directives";
       console.log(myDir);
       const Comp = () => <div use:myDir />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("reports aliased import used only as directive", () => {
    const result = runRule(
      solidJsxUsesVars,
      `import { clickOutside as myDir } from "./directives";
       const Comp = () => <div use:myDir />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("only used as");
  });
});
