import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noDangerWithChildren } from "./no-danger-with-children.js";

describe("react-builtins/no-danger-with-children — regressions", () => {
  // FP wave 4: a `{/* comment */}` or a nullish expression is not a
  // rendered child, so it does not conflict with dangerouslySetInnerHTML.
  it("does not flag dangerouslySetInnerHTML beside a JSX comment", () => {
    const result = runRule(
      noDangerWithChildren,
      `const a = <div dangerouslySetInnerHTML={{ __html: html }}>{/* note */}</div>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag dangerouslySetInnerHTML beside a nullish child", () => {
    const result = runRule(
      noDangerWithChildren,
      `const a = <div dangerouslySetInnerHTML={{ __html: html }}>{undefined}</div>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  // A `{/* comment */}` emits no child at all, so comment + single
  // nullish child still collapses to `children: null` — no conflict.
  it("does not flag dangerouslySetInnerHTML beside a comment and one nullish child", () => {
    const result = runRule(
      noDangerWithChildren,
      `const a = <div dangerouslySetInnerHTML={{ __html: html }}>{/* note */}{null}</div>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags dangerouslySetInnerHTML with real text children", () => {
    const result = runRule(
      noDangerWithChildren,
      `const a = <div dangerouslySetInnerHTML={{ __html: html }}>text</div>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  // fp-review PR991: TWO nullish children still become
  // `children: [null, null]`, an array `!= null` — React throws, so the
  // rule must fire even though each child is individually non-meaningful.
  it("still flags dangerouslySetInnerHTML with two nullish expression children", () => {
    const result = runRule(
      noDangerWithChildren,
      `const a = <div dangerouslySetInnerHTML={{ __html: html }}>{null}{null}</div>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags dangerouslySetInnerHTML with an expression child", () => {
    const result = runRule(
      noDangerWithChildren,
      `const a = <div dangerouslySetInnerHTML={{ __html: html }}>{body}</div>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  // The createElement path must mirror the JSX path: a nullish positional
  // child (`…, null)`) renders nothing and doesn't conflict.
  it("does not flag createElement with dangerouslySetInnerHTML and a null positional child", () => {
    const result = runRule(
      noDangerWithChildren,
      `const a = React.createElement("div", { dangerouslySetInnerHTML: { __html: html } }, null);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  // fp-review PR991: 2+ positional children are collected into an array,
  // so `props.children = [null, null] != null` and React throws.
  it("still flags createElement with dangerouslySetInnerHTML and two null positional children", () => {
    const result = runRule(
      noDangerWithChildren,
      `const a = React.createElement("div", { dangerouslySetInnerHTML: { __html: html } }, null, null);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags createElement with dangerouslySetInnerHTML and a real positional child", () => {
    const result = runRule(
      noDangerWithChildren,
      `const a = React.createElement("div", { dangerouslySetInnerHTML: { __html: html } }, "text");`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
