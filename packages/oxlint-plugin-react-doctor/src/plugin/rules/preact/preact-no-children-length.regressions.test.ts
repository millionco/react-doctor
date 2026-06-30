import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { preactNoChildrenLength } from "./preact-no-children-length.js";

describe("preact/preact-no-children-length — regressions", () => {
  it("stays silent on a plain data helper destructuring a `children` array field", () => {
    const { diagnostics } = runRule(
      preactNoChildrenLength,
      `function flattenTree({ children }) { return children.flatMap(flattenTree); }`,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("still flags array methods on children inside a JSX-rendering component", () => {
    const { diagnostics } = runRule(
      preactNoChildrenLength,
      `function List({ children }) { return <ul>{children.map((c) => <li />)}</ul>; }`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags props.children array access regardless of function name", () => {
    const { diagnostics } = runRule(
      preactNoChildrenLength,
      `function render(props) { return props.children.length; }`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });
});
