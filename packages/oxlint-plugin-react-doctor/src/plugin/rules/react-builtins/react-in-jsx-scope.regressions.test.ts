import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { reactInJsxScope } from "./react-in-jsx-scope.js";

const runJsx = (code: string) => runRule(reactInJsxScope, code, { filename: "fixture.jsx" });

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
});
