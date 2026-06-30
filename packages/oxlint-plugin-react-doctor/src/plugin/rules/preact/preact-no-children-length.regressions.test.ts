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

  it("stays silent when a local `children` shadows the prop", () => {
    const { diagnostics } = runRule(
      preactNoChildrenLength,
      `function List({ children }) { if (cond) { const children = getItems(); return children.map(x => x); } return null; }`,
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

  it("stays silent on a plain data helper reading a `props.children` array field", () => {
    const { diagnostics } = runRule(
      preactNoChildrenLength,
      `function flattenTree(props) { return props.children.map((child) => flattenTree(child)); }`,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("still flags props.children array access in a JSX-rendering function", () => {
    const { diagnostics } = runRule(
      preactNoChildrenLength,
      `function render(props) { return <div>{props.children.length}</div>; }`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags this.props.children array access in a class render method", () => {
    const { diagnostics } = runRule(
      preactNoChildrenLength,
      `import { Component } from "preact"; class C extends Component { render() { return this.props.children.map((child) => child); } }`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });
});
