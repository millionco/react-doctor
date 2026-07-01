import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { voidDomElementsNoChildren } from "./void-dom-elements-no-children.js";

describe("react-builtins/void-dom-elements-no-children — regressions", () => {
  // FP wave 4: a `{/* comment */}`, a formatting newline, or a nullish
  // expression renders no child, so a void element holding only those is
  // not an error.
  it("does not flag a void element holding only a JSX comment", () => {
    const result = runRule(voidDomElementsNoChildren, `const a = <input>{/* hint */}</input>;`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a void element with only a formatting newline", () => {
    const result = runRule(voidDomElementsNoChildren, `const a = (\n  <img src="x">\n  </img>\n);`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a void element with a nullish child expression", () => {
    const result = runRule(voidDomElementsNoChildren, `const a = <br>{undefined}</br>;`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  // `void 0` is `undefined` — React renders it as nothing, same as
  // `{undefined}` (pins the isNullishExpression void case for JSX children).
  it("does not flag a void element with a void-expression child", () => {
    const result = runRule(voidDomElementsNoChildren, `const a = <br>{void 0}</br>;`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags a void element with real text children", () => {
    const result = runRule(voidDomElementsNoChildren, `const a = <img>hi</img>;`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags a void element with a non-nullish child expression", () => {
    const result = runRule(voidDomElementsNoChildren, `const a = <img>{label}</img>;`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  // The createElement path must mirror the JSX path: a nullish positional
  // child renders nothing (RDE: `createElement("img", attr, null)` is the
  // idiomatic "no children" form and was falsely flagged).
  it("does not flag createElement('img', props, null)", () => {
    const result = runRule(
      voidDomElementsNoChildren,
      `const a = React.createElement("img", { alt: "x" }, null);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag createElement('br', null, undefined, void 0)", () => {
    const result = runRule(
      voidDomElementsNoChildren,
      `const a = React.createElement("br", null, undefined, void 0);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags createElement('img', props, child) with a real positional child", () => {
    const result = runRule(
      voidDomElementsNoChildren,
      `const a = React.createElement("img", { alt: "x" }, "hi");`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
