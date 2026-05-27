import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { preferModuleScopeStaticValue } from "./prefer-module-scope-static-value.js";

describe("prefer-module-scope-static-value", () => {
  it("flags an array of string literals inside a component", () => {
    const result = runRule(
      preferModuleScopeStaticValue,
      `
      function App() {
        const FILTER_OPTIONS = ["all", "active", "done"];
        return null;
      }
    `,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("FILTER_OPTIONS");
    expect(result.diagnostics[0].message).toContain("App");
  });

  it("flags a static config object inside a hook", () => {
    const result = runRule(
      preferModuleScopeStaticValue,
      `
      function useFeatureFlags() {
        const DEFAULT_FLAGS = { newUi: false, betaMode: true };
        return DEFAULT_FLAGS;
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("DEFAULT_FLAGS");
  });

  it("flags an array of literal objects", () => {
    const result = runRule(
      preferModuleScopeStaticValue,
      `
      function App() {
        const COLUMNS = [
          { id: "name", label: "Name" },
          { id: "age", label: "Age" },
        ];
        return null;
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag arrays that close over local state", () => {
    const result = runRule(
      preferModuleScopeStaticValue,
      `
      import { useState } from "react";

      function App() {
        const [count, setCount] = useState(0);
        const stats = [count, count + 1, count - 1];
        return null;
      }
    `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag objects that reference props", () => {
    const result = runRule(
      preferModuleScopeStaticValue,
      `
      function App({ theme }) {
        const styles = { color: theme.color, padding: 8 };
        return null;
      }
    `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag arrays of inline functions (function captures break hoisting)", () => {
    const result = runRule(
      preferModuleScopeStaticValue,
      `
      function App() {
        const handlers = [() => console.log("a"), () => console.log("b")];
        return null;
      }
    `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag arrays inside useMemo", () => {
    const result = runRule(
      preferModuleScopeStaticValue,
      `
      import { useMemo } from "react";

      function App() {
        const COLUMNS = useMemo(() => [{ id: "a" }, { id: "b" }], []);
        return null;
      }
    `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag values at module scope", () => {
    const result = runRule(
      preferModuleScopeStaticValue,
      `
      const FILTER_OPTIONS = ["all", "active", "done"];

      function App() {
        return null;
      }
    `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag values inside non-component helpers", () => {
    const result = runRule(
      preferModuleScopeStaticValue,
      `
      function makeApi() {
        const ENDPOINTS = ["/users", "/posts"];
        return ENDPOINTS;
      }
    `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag primitive constants", () => {
    const result = runRule(
      preferModuleScopeStaticValue,
      `
      function App() {
        const MAX = 100;
        const NAME = "App";
        const PI_OVER_2 = Math.PI / 2;
        return null;
      }
    `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("flags values that capture module-level imports as still hoistable", () => {
    const result = runRule(
      preferModuleScopeStaticValue,
      `
      import { ROLES } from "./constants";

      function App() {
        const RANKED_ROLES = [ROLES.admin, ROLES.editor, ROLES.viewer];
        return null;
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });
});
