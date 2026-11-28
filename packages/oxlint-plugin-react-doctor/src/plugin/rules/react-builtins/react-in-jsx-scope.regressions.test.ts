import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { reactInJsxScope } from "./react-in-jsx-scope.js";

const runJsx = (code: string) =>
  runRule(reactInJsxScope, code, { filename: "fixture.jsx", includeLocations: true });

describe("react-builtins/react-in-jsx-scope — regressions: scope-aware lookup", () => {
  it("does not flag when React is imported at the module level", () => {
    const result = runJsx(`
      import React from "react";
      function App() { return <div />; }
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("flags JSX in a function that has no React in scope even if a sibling function binds React", () => {
    const result = runJsx(`
      function HelperWithLocalReact() {
        const React = "not the real React";
        return null;
      }
      function App() {
        return <div />;
      }
    `);

    // Only App's JSX is unbound — HelperWithLocalReact's local React
    // doesn't reach across function scopes.
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag JSX inside a function that itself binds React locally", () => {
    const result = runJsx(`
      function App() {
        const React = require("react");
        return <div />;
      }
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag JSX nested inside a function scope where an outer function binds React", () => {
    const result = runJsx(`
      function Outer() {
        const React = require("react");
        function Inner() {
          return <div />;
        }
        return Inner();
      }
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("flags JSX inside a function whose React binding lives in a sibling block, not an ancestor", () => {
    const result = runJsx(`
      function App({ flag }) {
        if (flag) {
          const React = require("react");
        }
        return <div />;
      }
    `);

    // Block-scoped React inside the if doesn't reach the return outside.
    expect(result.diagnostics).toHaveLength(1);
  });
  it("resolves a catch binding for elements and fragments only inside its block", () => {
    const result = runJsx(`
      function render() {
        try {
          throw { React: require("react") };
        } catch ({ React }) {
          return <><span /></>;
        }
      }
      function other() { return <div />; }
    `);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({ nodeType: "JSXIdentifier", line: 9 });
  });

  it("resolves a loop binding only inside the loop", () => {
    const result = runJsx(`
      for (const React of [require("react")]) {
        render(<span />);
      }
      render(<div />);
    `);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({ nodeType: "JSXIdentifier", line: 5 });
  });

  it.each([
    'import type React from "react";',
    'import { type React } from "./types";',
    'import type React = require("react");',
    "type React = unknown;",
    "interface React {}",
  ])("requires a value binding when React is declared with %s", (declaration) => {
    const result = runRule(reactInJsxScope, `${declaration}\nexport const el = <span />;`, {
      filename: "fixture.tsx",
    });
    expect(result.diagnostics).toHaveLength(1);
  });

  it("allows separate type and value declarations with the same name", () => {
    const result = runRule(
      reactInJsxScope,
      `
        import React from "react";
        type React = unknown;
        export const el = <span />;
      `,
      { filename: "fixture.tsx" },
    );
    expect(result.diagnostics).toEqual([]);
  });
});
