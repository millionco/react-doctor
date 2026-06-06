import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { preferExistingHookLibrary } from "./prefer-existing-hook-library.js";

describe("prefer-existing-hook-library", () => {
  describe("flags top-level reimplementations", () => {
    it("flags a `useDebounce` function declaration", () => {
      const result = runRule(
        preferExistingHookLibrary,
        `
        import { useEffect, useState } from "react";

        function useDebounce(value, delay) {
          const [debounced, setDebounced] = useState(value);
          useEffect(() => {
            const handle = setTimeout(() => setDebounced(value), delay);
            return () => clearTimeout(handle);
          }, [value, delay]);
          return debounced;
        }
        `
      );

      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].message).toContain("useDebounce");
      expect(result.diagnostics[0].message).toContain("react-use");
    });

    it("flags a `useLocalStorage` arrow function const", () => {
      const result = runRule(
        preferExistingHookLibrary,
        `
        import { useCallback, useState } from "react";

        const useLocalStorage = (key, initial) => {
          const [value, setValue] = useState(() => {
            const raw = localStorage.getItem(key);
            return raw === null ? initial : JSON.parse(raw);
          });
          const setAndStore = useCallback((next) => {
            setValue(next);
            localStorage.setItem(key, JSON.stringify(next));
          }, [key]);
          return [value, setAndStore];
        };
        `
      );

      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].message).toContain("useLocalStorage");
      expect(result.diagnostics[0].message).toContain("react-use");
      expect(result.diagnostics[0].message).toContain("usehooks-ts");
    });

    it("flags an exported `useOnClickOutside` declaration", () => {
      const result = runRule(
        preferExistingHookLibrary,
        `
        import { useEffect } from "react";

        export function useOnClickOutside(ref, handler) {
          useEffect(() => {
            const listener = (event) => {
              if (!ref.current || ref.current.contains(event.target)) return;
              handler(event);
            };
            document.addEventListener("mousedown", listener);
            return () => document.removeEventListener("mousedown", listener);
          }, [ref, handler]);
        }
        `
      );

      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].message).toContain("useOnClickOutside");
      expect(result.diagnostics[0].message).toContain("usehooks-ts");
    });

    it("flags an `export const useToggle =` arrow", () => {
      const result = runRule(
        preferExistingHookLibrary,
        `
        import { useCallback, useState } from "react";

        export const useToggle = (initial = false) => {
          const [value, setValue] = useState(initial);
          const toggle = useCallback(() => setValue((current) => !current), []);
          return [value, toggle];
        };
        `
      );

      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].message).toContain("useToggle");
    });

    it("flags a TS-typed `useThrottle` const", () => {
      const result = runRule(
        preferExistingHookLibrary,
        `
        import { useEffect, useRef, useState } from "react";

        export const useThrottle = <T,>(value: T, limit: number): T => {
          const [throttled, setThrottled] = useState(value);
          const lastRan = useRef(Date.now());
          useEffect(() => {
            const handle = setTimeout(() => {
              if (Date.now() - lastRan.current >= limit) {
                setThrottled(value);
                lastRan.current = Date.now();
              }
            }, limit - (Date.now() - lastRan.current));
            return () => clearTimeout(handle);
          }, [value, limit]);
          return throttled;
        };
        `
      );

      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].message).toContain("useThrottle");
    });

    it("flags a `usePrevious` hook with a single useRef call", () => {
      const result = runRule(
        preferExistingHookLibrary,
        `
        import { useEffect, useRef } from "react";

        function usePrevious(value) {
          const ref = useRef();
          useEffect(() => {
            ref.current = value;
          });
          return ref.current;
        }
        `
      );

      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].message).toContain("usePrevious");
      expect(result.diagnostics[0].message).toContain("react-use");
    });

    it("flags an arrow with expression body that's a direct hook call", () => {
      // Regression: without the body-as-CallExpression check in
      // findReactHookCallInOwnBody, this one-liner reimplementation of
      // `useMount` slipped past while the parenthesized variant
      // `(cb) => (useEffect(cb, []))` was correctly caught — inconsistent.
      const result = runRule(
        preferExistingHookLibrary,
        `
        import { useEffect } from "react";

        export const useMount = (cb) => useEffect(cb, []);
        `
      );

      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].message).toContain("useMount");
    });

    it("flags an arrow with parenthesized hook-call body (consistency)", () => {
      const result = runRule(
        preferExistingHookLibrary,
        `
        import { useEffect } from "react";

        export const useMount = (cb) => (useEffect(cb, []));
        `
      );

      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].message).toContain("useMount");
    });

    it("flags an `export default function useDebounce` declaration", () => {
      const result = runRule(
        preferExistingHookLibrary,
        `
        import { useEffect, useState } from "react";

        export default function useDebounce(value, delay) {
          const [debounced, setDebounced] = useState(value);
          useEffect(() => {
            const handle = setTimeout(() => setDebounced(value), delay);
            return () => clearTimeout(handle);
          }, [value, delay]);
          return debounced;
        }
        `
      );

      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].message).toContain("useDebounce");
    });
  });

  describe("does not flag legitimate code", () => {
    it("does not flag a hook with no matching library name", () => {
      const result = runRule(
        preferExistingHookLibrary,
        `
        import { useState } from "react";

        function useMyCustomBusinessLogic() {
          const [value, setValue] = useState(0);
          return [value, setValue];
        }
        `
      );

      expect(result.diagnostics).toEqual([]);
    });

    it("does not flag a same-named function with NO React hook calls", () => {
      const result = runRule(
        preferExistingHookLibrary,
        `
        export function useDebounce(value, delay) {
          let last = 0;
          return () => {
            const now = Date.now();
            if (now - last < delay) return;
            last = now;
            return value;
          };
        }
        `
      );

      expect(result.diagnostics).toEqual([]);
    });

    it("does not flag a hook DEFINED INSIDE another component", () => {
      const result = runRule(
        preferExistingHookLibrary,
        `
        import { useEffect, useState } from "react";

        export function MyApp() {
          function useDebounce(value, delay) {
            const [debounced, setDebounced] = useState(value);
            useEffect(() => {
              const handle = setTimeout(() => setDebounced(value), delay);
              return () => clearTimeout(handle);
            }, [value, delay]);
            return debounced;
          }
          return null;
        }
        `
      );

      expect(result.diagnostics).toEqual([]);
    });

    it("does not flag a delegation wrapper that returns a same-named hook", () => {
      const result = runRule(
        preferExistingHookLibrary,
        `
        import { useDebounce as useDebounceUpstream } from "react-use";

        export function useDebounce(value) {
          return useDebounceUpstream(value, 500);
        }
        `
      );

      expect(result.diagnostics).toEqual([]);
    });

    it("does not flag an arrow-body delegation wrapper", () => {
      const result = runRule(
        preferExistingHookLibrary,
        `
        import { useDebounce as upstream } from "react-use";

        export const useDebounce = (value) => useDebounce(value, 500);
        `
      );

      expect(result.diagnostics).toEqual([]);
    });

    it("does not flag a pure re-export", () => {
      const result = runRule(
        preferExistingHookLibrary,
        `
        export { useDebounce } from "react-use";
        `
      );

      expect(result.diagnostics).toEqual([]);
    });

    it("does not flag a hook whose name only ambiguously matches React/router APIs", () => {
      const result = runRule(
        preferExistingHookLibrary,
        `
        import { useEffect, useState } from "react";

        export function useLocation() {
          const [pathname, setPathname] = useState(window.location.pathname);
          useEffect(() => {
            const onPop = () => setPathname(window.location.pathname);
            window.addEventListener("popstate", onPop);
            return () => window.removeEventListener("popstate", onPop);
          }, []);
          return { pathname };
        }
        `
      );

      expect(result.diagnostics).toEqual([]);
    });

    // Regression: `useDarkMode` is intentionally NOT in HOOK_LIBRARY_MAP.
    // The name is overloaded in the wild — most codebases ship a void
    // DOM-effect hook (tldraw / shadcn-style design systems), which is
    // semantically incompatible with usehooks-ts's `{ isDarkMode, toggle, … }`
    // state hook. Keeping it out keeps the FP rate down. Don't add it back
    // without first checking the v2 mitigations in `hook-libraries.ts`.
    it("does not flag a `useDarkMode` hook (intentionally excluded from map)", () => {
      const result = runRule(
        preferExistingHookLibrary,
        `
        import { useEffect } from "react";

        export function useDarkMode() {
          const colorMode = useColorMode();
          useEffect(() => {
            document.documentElement.classList.toggle("dark", colorMode === "dark");
          }, [colorMode]);
        }
        `
      );

      expect(result.diagnostics).toEqual([]);
    });

    it("does not flag a PascalCase same-name binding", () => {
      const result = runRule(
        preferExistingHookLibrary,
        `
        export class UseDebounce {
          run(value) {
            return value;
          }
        }
        `
      );

      expect(result.diagnostics).toEqual([]);
    });

    it("does not descend into nested function bodies when checking own-body hook calls", () => {
      const result = runRule(
        preferExistingHookLibrary,
        `
        import { useEffect } from "react";

        export const useEventListener = (target, type, callback) => {
          function attach() {
            const handler = () => useState(0);
            target.addEventListener(type, handler);
            return () => target.removeEventListener(type, handler);
          }
          attach();
        };
        `
      );

      expect(result.diagnostics).toEqual([]);
    });

    it("does not flag a hook defined inside another hook", () => {
      const result = runRule(
        preferExistingHookLibrary,
        `
        import { useEffect, useState } from "react";

        export function useResetOnNavigate() {
          function useToggle() {
            const [value, setValue] = useState(false);
            useEffect(() => {}, []);
            return [value, setValue];
          }
          return useToggle();
        }
        `
      );

      expect(result.diagnostics).toEqual([]);
    });

    it("does not double-report multiple shadowed declarations with the same name", () => {
      const result = runRule(
        preferExistingHookLibrary,
        `
        import { useEffect, useState } from "react";

        function useDebounce(value) {
          const [debounced, setDebounced] = useState(value);
          useEffect(() => {}, [value]);
          return debounced;
        }
        `
      );

      expect(result.diagnostics).toHaveLength(1);
    });

    it("does not flag a class method named like a library hook", () => {
      const result = runRule(
        preferExistingHookLibrary,
        `
        export class HookFactory {
          useDebounce(value, delay) {
            return value;
          }
        }
        `
      );

      expect(result.diagnostics).toEqual([]);
    });

    it("does not flag a TypeScript ambient `declare function`", () => {
      const result = runRule(
        preferExistingHookLibrary,
        `
        declare function useDebounce<T>(value: T, delay: number): T;
        `
      );

      expect(result.diagnostics).toEqual([]);
    });

    it("does not flag an anonymous default-exported function", () => {
      // No id binding to compare against the hook-name map.
      const result = runRule(
        preferExistingHookLibrary,
        `
        import { useEffect, useState } from "react";

        export default function (value) {
          const [v] = useState(value);
          useEffect(() => {}, []);
          return v;
        }
        `
      );

      expect(result.diagnostics).toEqual([]);
    });

    it("does not flag a re-binding via identifier assignment", () => {
      // VariableDeclarator.init is an Identifier, not a function — the
      // visitor early-returns before the hook-map lookup.
      const result = runRule(
        preferExistingHookLibrary,
        `
        import { useDebounce as upstream } from "react-use";

        export const useDebounce = upstream;
        `
      );

      expect(result.diagnostics).toEqual([]);
    });
  });
});
