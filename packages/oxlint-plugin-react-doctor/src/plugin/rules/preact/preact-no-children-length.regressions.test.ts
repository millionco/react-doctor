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

  it("flags props.children.length inside an event handler of a named JSX component", () => {
    const { diagnostics } = runRule(
      preactNoChildrenLength,
      `function List(props) {
        const onToggle = () => { console.log(props.children.length); };
        return <button onClick={onToggle}>t</button>;
      }`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("flags props.children.length inside a useMemo callback of a named JSX component", () => {
    const { diagnostics } = runRule(
      preactNoChildrenLength,
      `function List(props) {
        const count = useMemo(() => props.children.length, [props.children]);
        return <div>{count}</div>;
      }`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("flags an anonymous default-export component using h() instead of JSX", () => {
    const { diagnostics } = runRule(
      preactNoChildrenLength,
      `import { h } from "preact";
      export default function ({ children }) {
        return h("div", null, children.map((child) => h("span", null, child)));
      }`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("flags an uppercase-named h()-based component", () => {
    const { diagnostics } = runRule(
      preactNoChildrenLength,
      `import { h } from "preact";
      const List = ({ children }) => h("ul", null, children.map((child) => h("li", null, child)));`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("flags an uppercase component assigned via plain assignment (List = ...) without JSX", () => {
    const { diagnostics } = runRule(
      preactNoChildrenLength,
      `import { h } from "preact";
      let List;
      List = ({ children }) => h("ul", null, children.length);`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("flags props.children in a nested callback whose body has JSX", () => {
    const { diagnostics } = runRule(
      preactNoChildrenLength,
      `function List(props) {
        return <ul>{props.children.map((child) => <li>{child}</li>)}</ul>;
      }`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent on a data helper destructuring `children` inside a nested callback", () => {
    const { diagnostics } = runRule(
      preactNoChildrenLength,
      `function flattenTree({ children }) {
        const onVisit = () => children.length;
        return children.flatMap(flattenTree);
      }`,
    );
    expect(diagnostics).toHaveLength(0);
  });
});
