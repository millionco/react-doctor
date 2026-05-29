import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { preferStandardHook } from "./prefer-standard-hook.js";

describe("prefer-standard-hook", () => {
  it("flags a function-declaration reimplementation of a library hook", () => {
    const result = runRule(
      preferStandardHook,
      `
      import { useEffect, useState } from "react";

      export function useDebounce(value, delay) {
        const [debounced, setDebounced] = useState(value);
        useEffect(() => {
          const id = setTimeout(() => setDebounced(value), delay);
          return () => clearTimeout(id);
        }, [value, delay]);
        return debounced;
      }
    `,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("useDebounce");
    expect(result.diagnostics[0].message).toContain("react-standard-hooks");
    expect(result.diagnostics[0].nodeType).toBe("Identifier");
  });

  it("flags an arrow-function reimplementation assigned to a const", () => {
    const result = runRule(
      preferStandardHook,
      `
      import { useState } from "react";

      const useToggle = (initial = false) => {
        const [value, setValue] = useState(initial);
        const toggle = () => setValue((previous) => !previous);
        return [value, toggle];
      };
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("useToggle");
  });

  it("flags a function-expression reimplementation assigned to a const", () => {
    const result = runRule(
      preferStandardHook,
      `
      import { useEffect, useRef } from "react";

      const usePrevious = function (value) {
        const reference = useRef();
        useEffect(() => {
          reference.current = value;
        });
        return reference.current;
      };
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("usePrevious");
  });

  it("flags a reimplementation that calls React primitives via the namespace", () => {
    const result = runRule(
      preferStandardHook,
      `
      import * as React from "react";

      export function useLocalStorage(key, initial) {
        const [value, setValue] = React.useState(initial);
        React.useEffect(() => {
          window.localStorage.setItem(key, JSON.stringify(value));
        }, [key, value]);
        return [value, setValue];
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("useLocalStorage");
  });

  it("flags a reimplementation of a usehooks-ts-only hook", () => {
    const result = runRule(
      preferStandardHook,
      `
      import { useEffect } from "react";

      function useScrollLock() {
        useEffect(() => {
          const original = document.body.style.overflow;
          document.body.style.overflow = "hidden";
          return () => {
            document.body.style.overflow = original;
          };
        }, []);
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("useScrollLock");
  });

  it("flags a reimplementation built on useReducer", () => {
    const result = runRule(
      preferStandardHook,
      `
      import { useReducer } from "react";

      export const useCounter = (initial = 0) => {
        const [count, dispatch] = useReducer((state, delta) => state + delta, initial);
        return { count, increment: () => dispatch(1) };
      };
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("useCounter");
  });

  it("does not flag importing and using the library hook", () => {
    const result = runRule(
      preferStandardHook,
      `
      import { useDebounce } from "react-use";

      export function SearchBox() {
        useDebounce(() => {}, 200, []);
        return null;
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a thin wrapper that delegates to the library hook", () => {
    const result = runRule(
      preferStandardHook,
      `
      import { useDebounce as useLibraryDebounce } from "react-use";

      export const useDebounce = (callback, delay) => useLibraryDebounce(callback, delay, []);
    `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a wrapper that adds local state but still delegates to the library", () => {
    const result = runRule(
      preferStandardHook,
      `
      import { useState } from "react";
      import { useDebounce as useLibraryDebounce } from "react-use";

      export function useDebounce(value, delay) {
        const [ready, setReady] = useState(false);
        useLibraryDebounce(() => setReady(true), delay, [value]);
        return ready;
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a same-named helper that is not actually a hook", () => {
    const result = runRule(
      preferStandardHook,
      `
      const useMap = (entries) => new Map(entries);
      export function useToggle(value) {
        return !value;
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag hooks whose names are not in the library set", () => {
    const result = runRule(
      preferStandardHook,
      `
      import { useState, useEffect } from "react";

      export function useAuth() {
        const [user, setUser] = useState(null);
        useEffect(() => {}, []);
        return user;
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag the excluded useEvent name (React useEffectEvent polyfill)", () => {
    const result = runRule(
      preferStandardHook,
      `
      import { useCallback, useLayoutEffect, useRef } from "react";

      export function useEvent(handler) {
        const handlerRef = useRef(handler);
        useLayoutEffect(() => {
          handlerRef.current = handler;
        });
        return useCallback((...args) => handlerRef.current(...args), []);
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag generic-word hook names that collide with app-specific hooks", () => {
    const result = runRule(
      preferStandardHook,
      `
      import { useState, useCallback } from "react";

      export function useScroll(threshold) {
        const [scrolled, setScrolled] = useState(false);
        const onScroll = useCallback(() => setScrolled(window.scrollY > threshold), [threshold]);
        return scrolled;
      }

      export const useLocation = (initial) => {
        const [position, setPosition] = useState(initial);
        return [position, setPosition];
      };
    `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a non-function binding (conditional layout-effect alias)", () => {
    const result = runRule(
      preferStandardHook,
      `
      import { useEffect, useLayoutEffect } from "react";

      export const useIsomorphicLayoutEffect =
        typeof window !== "undefined" ? useLayoutEffect : useEffect;
    `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an object method that shares a library hook name", () => {
    const result = runRule(
      preferStandardHook,
      `
      import { useState } from "react";

      const hooks = {
        useToggle() {
          const [value, setValue] = useState(false);
          return [value, setValue];
        },
      };
    `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a hook that only calls another custom hook (v1 requires a React primitive)", () => {
    const result = runRule(
      preferStandardHook,
      `
      export function usePrevious(value) {
        return useTrackedValue(value);
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a reimplementation using an aliased React primitive (documented v1 non-goal)", () => {
    const result = runRule(
      preferStandardHook,
      `
      import { useState as useReactState } from "react";

      export const useToggle = (initial = false) => {
        const [value, setValue] = useReactState(initial);
        return [value, () => setValue((previous) => !previous)];
      };
    `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag in test-like files", () => {
    const result = runRule(
      preferStandardHook,
      `
      import { useState } from "react";

      export function useToggle(initial) {
        const [value, setValue] = useState(initial);
        return [value, setValue];
      }
    `,
      { filename: "use-toggle.test.tsx" },
    );

    expect(result.diagnostics).toHaveLength(0);
  });
});
