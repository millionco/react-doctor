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

  it("does not flag values inside a useMemo callback (the callback IS the memoised scope)", () => {
    const result = runRule(
      preferModuleScopeStaticValue,
      `
      import { useMemo } from "react";

      function App() {
        const result = useMemo(() => {
          const OPTS = ["a", "b"];
          return process(OPTS);
        }, []);
        return null;
      }
    `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag values inside a useCallback callback", () => {
    const result = runRule(
      preferModuleScopeStaticValue,
      `
      import { useCallback } from "react";

      function App() {
        const handler = useCallback(() => {
          const TARGETS = ["click", "tap"];
          TARGETS.forEach(register);
        }, []);
        return null;
      }
    `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a const that is mutated via `.push(...)` after init", () => {
    const result = runRule(
      preferModuleScopeStaticValue,
      `
      function App({ items }) {
        const OPTS = ["a", "b"];
        for (const item of items) OPTS.push(item);
        return null;
      }
    `,
    );

    // Hoisting OPTS would turn it into a shared module-level mutable
    // array — every render would append to the same array.
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a const that is reassigned later", () => {
    const result = runRule(
      preferModuleScopeStaticValue,
      `
      function App({ flag }) {
        let OPTS = ["a", "b"];
        if (flag) OPTS = ["a", "b", "c"];
        return null;
      }
    `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a const whose property is reassigned", () => {
    const result = runRule(
      preferModuleScopeStaticValue,
      `
      function App() {
        const CONFIG = { mode: "light" };
        CONFIG.mode = "dark";
        return null;
      }
    `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a const whose element is reassigned via index", () => {
    const result = runRule(
      preferModuleScopeStaticValue,
      `
      function App() {
        const OPTS = ["a", "b", "c"];
        OPTS[0] = "z";
        return null;
      }
    `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a const subject to `delete` on a property", () => {
    const result = runRule(
      preferModuleScopeStaticValue,
      `
      function App() {
        const CONFIG = { mode: "light", x: 1 };
        delete CONFIG.x;
        return null;
      }
    `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("DOES still flag a const that is only read via `.includes()` / `.find()` / `.map()`", () => {
    const result = runRule(
      preferModuleScopeStaticValue,
      `
      function App({ name }) {
        const NAMES = ["alice", "bob", "carol"];
        const isKnown = NAMES.includes(name);
        const upper = NAMES.map((entry) => entry.toUpperCase());
        const first = NAMES.find((entry) => entry.startsWith("a"));
        return null;
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("NAMES");
  });

  it("DOES still flag a const that's only accessed via property reads / index", () => {
    const result = runRule(
      preferModuleScopeStaticValue,
      `
      function App() {
        const CONFIG = { mode: "light", padding: 8 };
        const mode = CONFIG.mode;
        const length = CONFIG.padding + 1;
        return null;
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
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

  it("flags static values inside nested memo()-wrapped components (HOC does not memoize inner allocations)", () => {
    const result = runRule(
      preferModuleScopeStaticValue,
      `
      import { memo } from "react";

      function Parent() {
        const Inner = memo(() => {
          const OPTS = ["a", "b", "c"];
          return null;
        });
        return null;
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("OPTS");
  });

  it("flags static values inside a memo()-wrapped named function component", () => {
    const result = runRule(
      preferModuleScopeStaticValue,
      `
      import { memo } from "react";

      const App = memo(function App() {
        const OPTS = ["a", "b", "c"];
        return null;
      });
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("OPTS");
    expect(result.diagnostics[0].message).toContain("App");
  });

  it("flags static values inside a forwardRef()-wrapped named function component", () => {
    const result = runRule(
      preferModuleScopeStaticValue,
      `
      import { forwardRef } from "react";

      const Input = forwardRef(function Input(props, ref) {
        const SIZES = { sm: 12, md: 16, lg: 20 };
        return null;
      });
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("SIZES");
    expect(result.diagnostics[0].message).toContain("Input");
  });

  it("does not flag empty arrays used as mutable accumulators", () => {
    const result = runRule(
      preferModuleScopeStaticValue,
      `
      function App() {
        const parts = [];
        parts.push("hello");
        parts.push("world");
        return null;
      }
    `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag empty objects used as mutable accumulators", () => {
    const result = runRule(
      preferModuleScopeStaticValue,
      `
      function App() {
        const result = {};
        result.name = "foo";
        result.value = 42;
        return null;
      }
    `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag arrays mutated via indexed assignment", () => {
    const result = runRule(
      preferModuleScopeStaticValue,
      `
      function App() {
        const items = [];
        items[0] = "first";
        return null;
      }
    `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag objects mutated via method calls (e.g. Map-like .set)", () => {
    const result = runRule(
      preferModuleScopeStaticValue,
      `
      function useItems() {
        const lookup = {};
        lookup.toString = () => "custom";
        return lookup;
      }
    `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a static value declared inside an event handler", () => {
    const result = runRule(
      preferModuleScopeStaticValue,
      `
      function App() {
        const onClick = () => {
          const OPTS = ["a", "b", "c"];
          return OPTS.join(",");
        };
        return null;
      }
    `,
    );

    // \`OPTS\` is allocated per click, not per render — the nearest
    // enclosing function is the handler, not the component.
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag static values inside a PascalCase factory that returns an object literal", () => {
    // Regression: `AIHandlePlugin` (a ProseMirror plugin factory) is
    // PascalCase but returns a plain object and never re-renders. The
    // "reallocated every render" premise does not apply.
    const result = runRule(
      preferModuleScopeStaticValue,
      `
      const AIHandlePlugin = (options) => {
        const domEvents = { keydown: true };
        return { view: null, domEvents };
      };
    `,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags static values inside a hook that returns an object literal", () => {
    const result = runRule(
      preferModuleScopeStaticValue,
      `
      function useConfig() {
        const DEFAULTS = { a: 1, b: 2 };
        return { DEFAULTS };
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("DEFAULTS");
  });
});
