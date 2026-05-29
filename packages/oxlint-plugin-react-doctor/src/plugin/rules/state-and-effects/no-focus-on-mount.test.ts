import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noFocusOnMount } from "./no-focus-on-mount.js";

describe("no-focus-on-mount", () => {
  it("flags optional-chained focus() in an empty-deps useEffect", () => {
    const result = runRule(
      noFocusOnMount,
      `
      import { useEffect, useRef } from "react";

      export function SearchBox() {
        const inputRef = useRef(null);

        useEffect(() => {
          inputRef.current?.focus();
        }, []);

        return <input ref={inputRef} />;
      }
    `,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("steal focus");
  });

  it("flags plain member focus() in an empty-deps useLayoutEffect", () => {
    const result = runRule(
      noFocusOnMount,
      `
      import { useLayoutEffect, useRef } from "react";

      export function SearchBox() {
        const inputRef = useRef(null);

        useLayoutEffect(() => {
          inputRef.current.focus();
        }, []);

        return <input ref={inputRef} />;
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags focus() nested inside a non-conditional statement on mount", () => {
    const result = runRule(
      noFocusOnMount,
      `
      import { useEffect, useRef } from "react";

      export function SearchBox() {
        const inputRef = useRef(null);

        useEffect(() => {
          requestAnimationFrame(() => {
            inputRef.current?.focus();
          });
        }, []);

        return <input ref={inputRef} />;
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a focus() effect gated on an explicit open prop", () => {
    const result = runRule(
      noFocusOnMount,
      `
      import { useEffect, useRef } from "react";

      export function SearchBox({ isOpen }) {
        const inputRef = useRef(null);

        useEffect(() => {
          if (isOpen) inputRef.current?.focus();
        }, [isOpen]);

        return <input ref={inputRef} />;
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag focus() in an effect with no dependency array", () => {
    const result = runRule(
      noFocusOnMount,
      `
      import { useEffect, useRef } from "react";

      export function SearchBox() {
        const inputRef = useRef(null);

        useEffect(() => {
          inputRef.current?.focus();
        });

        return <input ref={inputRef} />;
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag empty-deps effects that never call focus()", () => {
    const result = runRule(
      noFocusOnMount,
      `
      import { useEffect, useRef } from "react";

      export function SearchBox() {
        const inputRef = useRef(null);

        useEffect(() => {
          inputRef.current?.scrollIntoView();
        }, []);

        return <input ref={inputRef} />;
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag computed `focus` member access", () => {
    const result = runRule(
      noFocusOnMount,
      `
      import { useEffect, useRef } from "react";

      export function SearchBox() {
        const inputRef = useRef(null);

        useEffect(() => {
          inputRef.current?.["focus"]();
        }, []);

        return <input ref={inputRef} />;
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag focus() inside a non-effect hook with empty deps", () => {
    const result = runRule(
      noFocusOnMount,
      `
      import { useMemo, useRef } from "react";

      export function SearchBox() {
        const inputRef = useRef(null);

        useMemo(() => {
          inputRef.current?.focus();
        }, []);

        return <input ref={inputRef} />;
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });
});
