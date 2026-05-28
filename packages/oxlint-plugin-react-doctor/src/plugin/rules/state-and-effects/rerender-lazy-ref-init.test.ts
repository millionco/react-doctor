import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rerenderLazyRefInit } from "./rerender-lazy-ref-init.js";

describe("rerender-lazy-ref-init", () => {
  it("flags useRef with a non-trivial function initializer", () => {
    const result = runRule(
      rerenderLazyRefInit,
      `
      import { useRef } from "react";

      function Component() {
        const ref = useRef(buildExpensiveCache());
      }
    `,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("buildExpensiveCache");
    expect(result.diagnostics[0].message).toContain("every render");
  });

  it("flags useRef with a member-expression initializer", () => {
    const result = runRule(
      rerenderLazyRefInit,
      `
      import { useRef } from "react";
      import * as cache from "./cache";

      function Component() {
        const ref = useRef(cache.build());
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("build");
  });

  it("does not flag useRef with a trivial wrapper initializer", () => {
    const result = runRule(
      rerenderLazyRefInit,
      `
      import { useRef } from "react";

      function Component() {
        const numberRef = useRef(Number("0"));
        const stringRef = useRef(String(value));
        const arrayRef = useRef(Array());
      }
    `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag useRef with a literal or identifier", () => {
    const result = runRule(
      rerenderLazyRefInit,
      `
      import { useRef } from "react";

      function Component(initial) {
        const a = useRef(null);
        const b = useRef(0);
        const c = useRef("");
        const d = useRef(initial);
      }
    `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag useRef with no arguments", () => {
    const result = runRule(
      rerenderLazyRefInit,
      `
      import { useRef } from "react";

      function Component() {
        const ref = useRef();
      }
    `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("flags useRef with `new AbortController()` (allocation discarded after first render)", () => {
    const result = runRule(
      rerenderLazyRefInit,
      `
      import { useRef } from "react";

      function Component() {
        const ref = useRef(new AbortController());
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("new AbortController()");
  });

  it("flags useRef with a `new Map()` / `new Set()` initializer", () => {
    const mapResult = runRule(
      rerenderLazyRefInit,
      `
      import { useRef } from "react";

      function Component() {
        const cache = useRef(new Map());
      }
    `,
    );
    const setResult = runRule(
      rerenderLazyRefInit,
      `
      import { useRef } from "react";

      function Component() {
        const seen = useRef(new Set());
      }
    `,
    );

    expect(mapResult.diagnostics).toHaveLength(1);
    expect(setResult.diagnostics).toHaveLength(1);
  });

  it("does NOT flag useRef capturing another hook's value", () => {
    const idResult = runRule(
      rerenderLazyRefInit,
      `
      import { useRef, useId } from "react";

      function Component() {
        const ref = useRef(useId());
      }
    `,
    );
    const contextResult = runRule(
      rerenderLazyRefInit,
      `
      import { useRef, useContext } from "react";

      function Component() {
        const ref = useRef(useContext(ThemeContext));
      }
    `,
    );

    // Hook results are already stable, and the suggested lazy-init fix
    // would call a hook conditionally — illegal. Don't flag them.
    expect(idResult.diagnostics).toEqual([]);
    expect(contextResult.diagnostics).toEqual([]);
  });
});
