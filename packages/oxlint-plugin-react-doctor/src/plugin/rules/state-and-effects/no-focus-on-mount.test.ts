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

  it("flags focus() scheduled with requestAnimationFrame on mount", () => {
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

  it("flags focus() deferred through setTimeout on mount", () => {
    const result = runRule(
      noFocusOnMount,
      `
      import { useEffect, useRef } from "react";

      export function SearchBox() {
        const inputRef = useRef(null);

        useEffect(() => {
          setTimeout(() => inputRef.current?.focus(), 0);
        }, []);

        return <input ref={inputRef} />;
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags focus() through a parenthesized callee", () => {
    const result = runRule(
      noFocusOnMount,
      `
      import { useEffect, useRef } from "react";

      export function SearchBox() {
        const inputRef = useRef(null);

        useEffect(() => {
          (inputRef.current.focus)();
        }, []);

        return <input ref={inputRef} />;
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags focus() inside an immediately invoked function on mount", () => {
    const result = runRule(
      noFocusOnMount,
      `
      import { useEffect, useRef } from "react";

      export function SearchBox() {
        const inputRef = useRef(null);

        useEffect(() => {
          (() => {
            inputRef.current?.focus();
          })();
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

  it("does not flag focus() inside an event listener registered on mount", () => {
    const result = runRule(
      noFocusOnMount,
      `
      import { useEffect, useRef } from "react";

      export function SearchBox() {
        const inputRef = useRef(null);

        useEffect(() => {
          const handleKeydown = (event) => {
            if (event.key === "/") inputRef.current?.focus();
          };
          window.addEventListener("keydown", handleKeydown);
          return () => window.removeEventListener("keydown", handleKeydown);
        }, []);

        return <input ref={inputRef} />;
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag focus() inside an inline event-listener callback", () => {
    const result = runRule(
      noFocusOnMount,
      `
      import { useEffect, useRef } from "react";

      export function SearchBox() {
        const inputRef = useRef(null);

        useEffect(() => {
          document.addEventListener("click", () => inputRef.current?.focus());
        }, []);

        return <input ref={inputRef} />;
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag focus() restored in the effect cleanup", () => {
    const result = runRule(
      noFocusOnMount,
      `
      import { useEffect, useRef } from "react";

      export function Dialog() {
        const triggerRef = useRef(null);

        useEffect(() => {
          return () => {
            triggerRef.current?.focus();
          };
        }, []);

        return null;
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a scheduler focus() nested inside an event listener", () => {
    const result = runRule(
      noFocusOnMount,
      `
      import { useEffect, useRef } from "react";

      export function SearchBox() {
        const inputRef = useRef(null);

        useEffect(() => {
          window.addEventListener("click", () => {
            setTimeout(() => inputRef.current?.focus(), 0);
          });
        }, []);

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

  it("does not flag a sparse, non-empty dependency array", () => {
    const result = runRule(
      noFocusOnMount,
      `
      import { useEffect, useRef } from "react";

      export function SearchBox({ isOpen }) {
        const inputRef = useRef(null);

        useEffect(() => {
          inputRef.current?.focus();
        }, [isOpen]);

        return <input ref={inputRef} />;
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag autofocus-on-mount in testlike files", () => {
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
      { filename: "search-box.test.tsx" },
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
