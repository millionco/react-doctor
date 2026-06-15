import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noCallComponentAsFunction } from "./no-call-component-as-function.js";

describe("no-call-component-as-function", () => {
  it("flags calling a component that is also rendered as JSX", () => {
    const result = runRule(
      noCallComponentAsFunction,
      `
      const Row = ({ item }) => <li>{item}</li>;
      const List = ({ items }) => (
        <ul>{items.map((item) => Row({ item }))}</ul>
      );
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("<Row />");
  });

  it("flags a direct call used as a child expression", () => {
    const result = runRule(
      noCallComponentAsFunction,
      `
      const Header = () => <h1>Hi</h1>;
      const Page = () => <div>{Header()}</div>;
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a component only ever rendered as JSX", () => {
    const result = runRule(
      noCallComponentAsFunction,
      `
      const Row = ({ item }) => <li>{item}</li>;
      const List = ({ items }) => <ul>{items.map((item) => <Row key={item} item={item} />)}</ul>;
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag PascalCase non-components that are never rendered as JSX", () => {
    const result = runRule(
      noCallComponentAsFunction,
      `const ok = Boolean(value); const n = Number(input); const arr = Array(3);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag `new Component()` (constructor, not a plain call)", () => {
    const result = runRule(
      noCallComponentAsFunction,
      `
      const Widget = () => <div />;
      const w = new Widget();
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag passing a component as a value (not calling it)", () => {
    const result = runRule(
      noCallComponentAsFunction,
      `
      const Icon = () => <svg />;
      const App = () => <Button icon={Icon} render={Icon} />;
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a lowercase function call sharing nothing with JSX", () => {
    const result = runRule(
      noCallComponentAsFunction,
      `
      const Box = () => <div />;
      const cls = clsx("a", "b");
      const App = () => <Box />;
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a parameter that shadows a component name (scope-safe)", () => {
    const result = runRule(
      noCallComponentAsFunction,
      `
      const Row = () => <li />;
      function renderWith(Row) { return Row({ x: 1 }); }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a member-expression call (`obj.Method()`)", () => {
    const result = runRule(
      noCallComponentAsFunction,
      `
      const Tab = () => <div />;
      const App = () => { Namespace.Tab(); return <Tab />; };
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
