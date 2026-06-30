import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noPolymorphicChildren } from "./no-polymorphic-children.js";

describe("no-polymorphic-children", () => {
  it('flags `typeof children === "string"` on a destructured prop', () => {
    const result = runRule(
      noPolymorphicChildren,
      `const Button = ({ children }) =>
        typeof children === "string" ? <span>{children}</span> : <div>{children}</div>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it('flags `typeof props.children === "string"`', () => {
    const result = runRule(
      noPolymorphicChildren,
      `const Button = (props) =>
        typeof props.children === "string" ? <span /> : <div />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  // A `children` destructured from local data (not the component's
  // props) is an ordinary variable, not a polymorphic-children smell.
  it("does not flag `children` destructured from a local variable", () => {
    const result = runRule(
      noPolymorphicChildren,
      `const r = (node) => {
        const { children } = node;
        if (typeof children === "string") return <Leaf text={children} />;
        return <Branch>{children.map(r)}</Branch>;
      };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
