import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noEffectWithFreshDeps } from "./no-effect-with-fresh-deps.js";

describe("no-effect-with-fresh-deps", () => {
  it("flags a freshly-allocated object in useEffect deps", () => {
    const result = runRule(
      noEffectWithFreshDeps,
      `
      import { useEffect } from "react";

      function Component({ a, b }) {
        useEffect(() => {
          // ...
        }, [{ a, b }]);
      }
    `,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("useEffect");
    expect(result.diagnostics[0].message).toContain("object");
  });

  it("flags a freshly-allocated array in useEffect deps", () => {
    const result = runRule(
      noEffectWithFreshDeps,
      `
      import { useEffect } from "react";

      function Component({ x, y }) {
        useEffect(() => {}, [[x, y]]);
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("array");
  });

  it("flags an inline function in useMemo deps", () => {
    const result = runRule(
      noEffectWithFreshDeps,
      `
      import { useMemo } from "react";

      function Component() {
        const value = useMemo(() => 1, [() => doStuff()]);
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("function");
  });

  it("flags a NewExpression in useCallback deps", () => {
    const result = runRule(
      noEffectWithFreshDeps,
      `
      import { useCallback } from "react";

      function Component() {
        const onClick = useCallback(() => {}, [new Set([1, 2, 3])]);
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("instance");
  });

  it("flags useLayoutEffect with inline deps too", () => {
    const result = runRule(
      noEffectWithFreshDeps,
      `
      import { useLayoutEffect } from "react";

      function Component() {
        useLayoutEffect(() => {}, [{}]);
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("useLayoutEffect");
  });

  it("reports each fresh dep separately when several are present", () => {
    const result = runRule(
      noEffectWithFreshDeps,
      `
      import { useEffect } from "react";

      function Component({ a, b, c }) {
        useEffect(() => {}, [{ a }, [b], () => c]);
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(3);
  });

  it("does not flag identifier dependencies", () => {
    const result = runRule(
      noEffectWithFreshDeps,
      `
      import { useEffect, useMemo } from "react";

      function Component({ user, items }) {
        const stableObj = useMemo(() => ({ user }), [user]);
        useEffect(() => {}, [user, items, stableObj]);
      }
    `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag empty deps", () => {
    const result = runRule(
      noEffectWithFreshDeps,
      `
      import { useEffect } from "react";

      function Component() {
        useEffect(() => {
          doIt();
        }, []);
      }
    `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag effects without a deps array (run on every render is intentional)", () => {
    const result = runRule(
      noEffectWithFreshDeps,
      `
      import { useEffect } from "react";

      function Component() {
        useEffect(() => {
          doIt();
        });
      }
    `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag member-expression deps", () => {
    const result = runRule(
      noEffectWithFreshDeps,
      `
      import { useEffect } from "react";

      function Component({ options }) {
        useEffect(() => {}, [options.value, options.callback]);
      }
    `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("flags freshly-allocated dep through React.useEffect", () => {
    const result = runRule(
      noEffectWithFreshDeps,
      `
      import * as React from "react";

      function Component({ a }) {
        React.useEffect(() => {}, [{ a }]);
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an Identifier dep whose binding is a render-local object literal", () => {
    const result = runRule(
      noEffectWithFreshDeps,
      `
      import { useEffect } from "react";

      function Component({ a, b }) {
        const config = { a, b };
        useEffect(() => {}, [config]);
      }
    `,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("config");
    expect(result.diagnostics[0].message).toContain("object");
  });

  it("flags an Identifier dep whose binding is a render-local array literal", () => {
    const result = runRule(
      noEffectWithFreshDeps,
      `
      import { useEffect } from "react";

      function Component({ x }) {
        const xs = [x, x + 1];
        useEffect(() => {}, [xs]);
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("xs");
    expect(result.diagnostics[0].message).toContain("array");
  });

  it("flags an Identifier dep whose binding is a render-local arrow function", () => {
    const result = runRule(
      noEffectWithFreshDeps,
      `
      import { useEffect } from "react";

      function Component() {
        const handler = () => doStuff();
        useEffect(() => {}, [handler]);
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("handler");
  });

  it("does NOT flag an Identifier dep whose binding is at module scope", () => {
    const result = runRule(
      noEffectWithFreshDeps,
      `
      import { useEffect } from "react";

      const CONFIG = { a: 1, b: 2 };

      function Component() {
        useEffect(() => {}, [CONFIG]);
      }
    `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("does NOT flag an Identifier dep whose binding comes from useMemo / useCallback", () => {
    const result = runRule(
      noEffectWithFreshDeps,
      `
      import { useEffect, useMemo, useCallback } from "react";

      function Component({ a, b }) {
        const config = useMemo(() => ({ a, b }), [a, b]);
        const handler = useCallback(() => doStuff(a), [a]);
        useEffect(() => {}, [config, handler]);
      }
    `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("does NOT flag an Identifier dep whose binding comes from useRef", () => {
    const result = runRule(
      noEffectWithFreshDeps,
      `
      import { useEffect, useRef } from "react";

      function Component() {
        const ref = useRef({});
        useEffect(() => {}, [ref]);
      }
    `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("does NOT flag an Identifier dep that comes from a custom hook (opaque)", () => {
    const result = runRule(
      noEffectWithFreshDeps,
      `
      import { useEffect } from "react";

      function Component() {
        const data = useMyCustomHook();
        useEffect(() => {}, [data]);
      }
    `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("does NOT flag a destructured prop with an array default", () => {
    const result = runRule(
      noEffectWithFreshDeps,
      `
      import { useEffect } from "react";

      function List({ items = [] }) {
        useEffect(() => {}, [items]);
      }
    `,
    );

    // \`items\` is a prop, not a render-local allocation — the default
    // only allocates when the caller omits it, and "hoist to module
    // scope" doesn't apply to a prop.
    expect(result.diagnostics).toEqual([]);
  });

  it("does NOT flag a destructured prop with an object default", () => {
    const result = runRule(
      noEffectWithFreshDeps,
      `
      import { useEffect } from "react";

      function Panel({ config = {} }) {
        useEffect(() => {}, [config]);
      }
    `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("does NOT flag a destructured const default (allocates only when source is undefined)", () => {
    const result = runRule(
      noEffectWithFreshDeps,
      `
      import { useEffect } from "react";

      function Panel(props) {
        const { config = {} } = props;
        useEffect(() => {}, [config]);
      }
    `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("DOES still flag a direct const object initializer captured by name", () => {
    const result = runRule(
      noEffectWithFreshDeps,
      `
      import { useEffect } from "react";

      function Panel() {
        const config = { a: 1 };
        useEffect(() => {}, [config]);
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("config");
  });
});
