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

describe("react-builtins/react-in-jsx-scope — JSX runtime advice", () => {
  it("keeps the rule opt-in and qualifies its runtime-dependent advice", () => {
    expect(reactInJsxScope.defaultEnabled).toBe(false);
    expect(reactInJsxScope.severity).toBe("warn");
    expect(reactInJsxScope.title).toBe("JSX may need a React binding");
    expect(reactInJsxScope.recommendation).toBe(
      "Import or provide `React` only when the selected JSX transform requires that binding. Disable this rule for automatic runtimes, build-injected React factories, or custom factories that do not use `React`.",
    );
  });

  it.each([
    ["unspecified transform", "const App = () => <main />;"],
    ["classic runtime", "/** @jsxRuntime classic */\nconst App = () => <main />;"],
    ["automatic runtime", "/** @jsxRuntime automatic */\nconst App = () => <main />;"],
    [
      "custom factory",
      "/** @jsx h */\nimport { h } from 'custom-jsx';\nconst App = () => <main />;",
    ],
  ])("keeps source-only membership with qualified advice for %s", (_runtime, code) => {
    const result = runJsx(code);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([
      {
        message:
          "`React` may be needed for classic JSX output; automatic runtimes and build-injected factories can make an application import unnecessary.",
        nodeType: "JSXIdentifier",
      },
    ]);
  });

  it("preserves each fragment and element location with the same conditional message", () => {
    const result = runRule(reactInJsxScope, "const App = () => <><main /><aside /></>;", {
      filename: "fixture.jsx",
      includeLocations: true,
    });

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([
      {
        message:
          "`React` may be needed for classic JSX output; automatic runtimes and build-injected factories can make an application import unnecessary.",
        nodeType: "JSXOpeningFragment",
        line: 1,
        column: 18,
      },
      {
        message:
          "`React` may be needed for classic JSX output; automatic runtimes and build-injected factories can make an application import unnecessary.",
        nodeType: "JSXIdentifier",
        line: 1,
        column: 21,
      },
      {
        message:
          "`React` may be needed for classic JSX output; automatic runtimes and build-injected factories can make an application import unnecessary.",
        nodeType: "JSXIdentifier",
        line: 1,
        column: 29,
      },
    ]);
  });
});
