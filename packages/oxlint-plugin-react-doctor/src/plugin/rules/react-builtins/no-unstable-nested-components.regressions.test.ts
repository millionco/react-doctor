import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noUnstableNestedComponents } from "./no-unstable-nested-components.js";

const run = (code: string) =>
  runRule(noUnstableNestedComponents, code, { filename: "fixture.tsx" });

describe("react-builtins/no-unstable-nested-components — regressions", () => {
  it("flags a nested PascalCase component rendered as JSX", () => {
    const result = run(`
      const Parent = () => {
        const GeneralSection = () => <div>x</div>;
        return <div><GeneralSection /></div>;
      };
    `);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags a nested PascalCase component instantiated via createElement", () => {
    const result = run(`
      function Parent() {
        function Inner() { return React.createElement("div", null); }
        return React.createElement("div", null, React.createElement(Inner, null));
      }
    `);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("does not flag a nested PascalCase render helper only called inline", () => {
    const result = run(`
      const Parent = () => {
        const GeneralSection = () => <div>x</div>;
        return <div>{GeneralSection()}</div>;
      };
    `);
    expect(result.diagnostics).toEqual([]);
  });

  // The instantiation gate is keyed by SYMBOL: a same-named JSX usage of
  // a DIFFERENT binding (an import rendered elsewhere in the file) must
  // not count as instantiation of the nested inline helper.
  it("does not flag a nested inline helper whose name collides with a rendered import", () => {
    const result = run(`
      import { Item } from "./item";
      const List = () => <ul><Item /></ul>;
      const Parent = () => {
        const Item = () => <li>local</li>;
        return <ol>{Item()}</ol>;
      };
    `);
    expect(result.diagnostics).toEqual([]);
  });

  // A named FunctionExpression binds the OUTER name via its declarator
  // (`const X = function Y() {}` — references resolve to X, Y only binds
  // inside the body), so the gate must key off the declarator id.
  it("flags a nested named-function-expression component instantiated via its variable", () => {
    const result = run(`
      const Parent = () => {
        const Child = function Child() { return <div>x</div>; };
        return <div><Child /></div>;
      };
    `);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
