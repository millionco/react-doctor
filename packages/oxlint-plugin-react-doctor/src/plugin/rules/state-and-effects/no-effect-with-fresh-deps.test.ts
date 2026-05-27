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
});
