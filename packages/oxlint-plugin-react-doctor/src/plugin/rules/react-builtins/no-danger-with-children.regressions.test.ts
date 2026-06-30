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

  it("still flags dangerouslySetInnerHTML with real text children", () => {
    const result = runRule(
      noDangerWithChildren,
      `const a = <div dangerouslySetInnerHTML={{ __html: html }}>text</div>;`,
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
});
