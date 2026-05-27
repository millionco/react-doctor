import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { preactNoChildrenLength } from "./preact-no-children-length.js";

describe("preact-no-children-length", () => {
  it("flags `props.children.length`", () => {
    const result = runRule(
      preactNoChildrenLength,
      `
      function List(props) {
        return <div>{props.children.length} items</div>;
      }
      `,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("toChildArray");
  });

  it("flags `props.children.map(...)`", () => {
    const result = runRule(
      preactNoChildrenLength,
      `
      function Tabs(props) {
        return <div>{props.children.map((child, i) => <div key={i}>{child}</div>)}</div>;
      }
      `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags `this.props.children.forEach(...)`", () => {
    const result = runRule(
      preactNoChildrenLength,
      `
      import { Component } from "preact";

      class TabPanel extends Component {
        render() {
          const items = [];
          this.props.children.forEach(child => items.push(child));
          return <div>{items}</div>;
        }
      }
      `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags `props.children.filter(...)`", () => {
    const result = runRule(
      preactNoChildrenLength,
      `
      function FilteredList(props) {
        const visible = props.children.filter(Boolean);
        return <ul>{visible}</ul>;
      }
      `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags destructured `children.length`", () => {
    const result = runRule(
      preactNoChildrenLength,
      `
      function Counter({ children }) {
        return <span>{children.length} items</span>;
      }
      `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags destructured `children.map(...)`", () => {
    const result = runRule(
      preactNoChildrenLength,
      `
      function Wrapper({ children }) {
        return <div>{children.map((child, i) => <section key={i}>{child}</section>)}</div>;
      }
      `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag `toChildArray(children).length`", () => {
    const result = runRule(
      preactNoChildrenLength,
      `
      import { toChildArray } from "preact";

      function List(props) {
        return <div>{toChildArray(props.children).length} items</div>;
      }
      `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag `toChildArray(children).map(...)`", () => {
    const result = runRule(
      preactNoChildrenLength,
      `
      import { toChildArray } from "preact";

      function Tabs({ children }) {
        return <div>{toChildArray(children).map((child, i) => <div key={i}>{child}</div>)}</div>;
      }
      `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag unrelated `.length` access", () => {
    const result = runRule(
      preactNoChildrenLength,
      `
      function ItemList({ items }) {
        return <span>{items.length} items</span>;
      }
      `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag `React.Children.map(...)`", () => {
    const result = runRule(
      preactNoChildrenLength,
      `
      import React from "preact/compat";

      function Wrapper(props) {
        return <div>{React.Children.map(props.children, child => child)}</div>;
      }
      `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag computed property access on children", () => {
    const result = runRule(
      preactNoChildrenLength,
      `
      function Dynamic(props) {
        const method = "map";
        return <div>{props.children[method]}</div>;
      }
      `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag bracket index access `props.children[0]`", () => {
    const result = runRule(
      preactNoChildrenLength,
      `
      function First(props) {
        return <div>{props.children[0]}</div>;
      }
      `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a local variable named `children` that is not from props", () => {
    const result = runRule(
      preactNoChildrenLength,
      `
      const Sidebar = () => {
        const children = fetchChildNodes();
        return <ul>{children.map(c => <li key={c.id}>{c.name}</li>)}</ul>;
      };
      `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag `children.length` in a non-component function", () => {
    const result = runRule(
      preactNoChildrenLength,
      `
      const getCount = (children) => children.length;
      `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });
});
