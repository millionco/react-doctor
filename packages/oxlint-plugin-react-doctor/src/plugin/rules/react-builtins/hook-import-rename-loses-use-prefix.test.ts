import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { hookImportRenameLosesUsePrefix } from "./hook-import-rename-loses-use-prefix.js";

describe("hook-import-rename-loses-use-prefix", () => {
  it("does not infer hook semantics from an external export name alone", () => {
    const result = runRule(
      hookImportRenameLosesUsePrefix,
      `import { useQuery as getProducts } from "@tanstack/react-query";
       const Products = () => {
         const products = getProducts();
         return null;
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a useState alias to a lowercase name that is called", () => {
    const result = runRule(
      hookImportRenameLosesUsePrefix,
      `import { useState as state } from "react";
       const Counter = () => {
         const [count, setCount] = state(0);
         return null;
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags each renamed hook in a multi-specifier import when both are called", () => {
    const result = runRule(
      hookImportRenameLosesUsePrefix,
      `import { useMemo as memoize, useCallback as cb } from "react";
       const Widget = () => {
         const value = memoize(() => 1, []);
         const handler = cb(() => {}, []);
         return null;
       };`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("does not infer hook semantics from a third-party package export", () => {
    const result = runRule(
      hookImportRenameLosesUsePrefix,
      `import { useFormik as formik } from "formik";
       const Form = () => {
         const formikBag = formik({ initialValues: {} });
         return null;
       };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a local-hooks-module hook rename that is called", () => {
    const result = runRule(
      hookImportRenameLosesUsePrefix,
      `import { useDebouncedValue as debounced } from "./hooks/useDebouncedValue";
       const Search = () => {
         const query = debounced("", 300);
         return null;
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not infer digit-named hook semantics from an external package export", () => {
    const result = runRule(
      hookImportRenameLosesUsePrefix,
      `import { use100vh as viewportHeight } from "react-div-100vh";
       const Panel = () => {
         const height = viewportHeight();
         return null;
       };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag MDX's use-prefixed component factory API", () => {
    const result = runRule(
      hookImportRenameLosesUsePrefix,
      `import { useMDXComponents as getMDXComponents } from "nextra-theme-docs";
       const components = getMDXComponents();`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a renamed hook called through an event-handler callback", () => {
    const result = runRule(
      hookImportRenameLosesUsePrefix,
      `import { useEffect as runEffect } from "react";
       const App = () => {
         runEffect(() => {}, []);
         return null;
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags useEffect renamed to useBrowserEffect", () => {
    const result = runRule(
      hookImportRenameLosesUsePrefix,
      `import { useEffect as useBrowserEffect } from "react";
       const Row = () => {
         useBrowserEffect(() => () => resetRow(), []);
         return null;
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag an alias that keeps a valid hook name", () => {
    const result = runRule(
      hookImportRenameLosesUsePrefix,
      `import { useQuery as useProducts } from "@tanstack/react-query";
       const Products = () => {
         const products = useProducts();
         return null;
       };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an alias with a digit after use, which react-hooks still recognises as a hook (use2FA)", () => {
    const result = runRule(
      hookImportRenameLosesUsePrefix,
      `import { useTwoFactorAuth as use2FA } from "./hooks/use-two-factor-auth";
       const Settings = () => {
         const codes = use2FA();
         return null;
       };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a non-use hook renamed to React's conditionally-callable bare use name", () => {
    const result = runRule(
      hookImportRenameLosesUsePrefix,
      `import { useState as use } from "react";
       const Counter = ({ enabled }) => {
         if (enabled) use(0);
         return null;
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag React's bare use hook when its alias remains a hook name", () => {
    const result = runRule(
      hookImportRenameLosesUsePrefix,
      `import { use as usePromise } from "react";
       const Products = ({ productsPromise }) => usePromise(productsPromise);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag the isomorphic SSR wrapper where the alias is only conditionally reassigned, never called (Radix useLayoutEffect idiom)", () => {
    const result = runRule(
      hookImportRenameLosesUsePrefix,
      `import { useLayoutEffect as ReactUseLayoutEffect } from "react";
       const useLayoutEffect = globalThis?.document ? ReactUseLayoutEffect : () => {};
       export { useLayoutEffect };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a renamed hook alias that is only re-exported, never called (barrel re-export idiom)", () => {
    const result = runRule(
      hookImportRenameLosesUsePrefix,
      `import { useStore as createStoreHook } from "./store";
       export default createStoreHook;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a renamed hook alias only passed as an argument, never called (HOC/factory wiring idiom)", () => {
    const result = runRule(
      hookImportRenameLosesUsePrefix,
      `import { useTheme as themeHook } from "./theme";
       const withTheme = registerHook(themeHook);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a renamed hook import that is never referenced", () => {
    const result = runRule(
      hookImportRenameLosesUsePrefix,
      `import { useQuery as getProducts } from "@tanstack/react-query";`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when the imported name is not a hook", () => {
    const result = runRule(
      hookImportRenameLosesUsePrefix,
      `import { makeRequest as getProducts } from "./api";
       const products = getProducts();`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a bare `use` export rename, which is not a React hook name in import position (chai's use)", () => {
    const result = runRule(
      hookImportRenameLosesUsePrefix,
      `import { use as chaiUse } from "chai";
       chaiUse(plugin);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a React 19 use import alias that drops the use prefix", () => {
    const result = runRule(
      hookImportRenameLosesUsePrefix,
      `import { use as readPromise } from "react";
       const Products = ({ productsPromise }) => {
         const products = readPromise(productsPromise);
         return products.length;
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags renamed hooks called through transparent TypeScript wrappers", () => {
    const result = runRule(
      hookImportRenameLosesUsePrefix,
      `import {
         useAlpha as alpha,
         useBeta as beta,
         useGamma as gamma,
       } from "./hooks";
       alpha!();
       (beta as () => void)();
       (gamma satisfies () => void)();`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(3);
  });

  it("does not flag a default import (no imported hook name to mismatch)", () => {
    const result = runRule(
      hookImportRenameLosesUsePrefix,
      `import useQuery from "./hooks/useQuery";`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a plain named import with no rename", () => {
    const result = runRule(hookImportRenameLosesUsePrefix, `import { useState } from "react";`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag imported names that fail /^use[A-Z0-9]/", () => {
    const result = runRule(
      hookImportRenameLosesUsePrefix,
      `import { useless as helper } from "./util";
       import { user as currentUser } from "./m";
       import { used as consumed } from "./flags";
       helper();
       currentUser();
       consumed();`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a local reassignment of a hook (not an import specifier)", () => {
    const result = runRule(
      hookImportRenameLosesUsePrefix,
      `const useThing = something; const renamed = useThing;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a type-only hook import specifier", () => {
    const result = runRule(
      hookImportRenameLosesUsePrefix,
      `import { type useThing as thing } from "./hooks";`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a test-file hook alias used to wrap for mocking", () => {
    const result = runRule(
      hookImportRenameLosesUsePrefix,
      `import { useTracking as baseUseTracking } from "react-tracking";
       const tracking = baseUseTracking();`,
      { filename: "src/Apps/Auctions/__tests__/MyBids.jest.tsx" },
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an unconditional same-name wrapper", () => {
    const result = runRule(
      hookImportRenameLosesUsePrefix,
      `import { useNavigate as routerUseNavigate } from "react-router-dom";
       export const useNavigate = () => routerUseNavigate();`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an unconditional custom hook wrapper", () => {
    const result = runRule(
      hookImportRenameLosesUsePrefix,
      `import { useQuery as query } from "@tanstack/react-query";
       export const useProducts = () => query({ queryKey: ["products"] });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not infer hook provenance from an external package name", () => {
    const result = runRule(
      hookImportRenameLosesUsePrefix,
      `import { useQuery as query } from "@tanstack/react-query";
       export const useProducts = async () => query({ queryKey: ["products"] });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags renamed React dependency hooks inside unconditional custom hook wrappers", () => {
    const result = runRule(
      hookImportRenameLosesUsePrefix,
      `import {
         useEffect as effect,
         useLayoutEffect as useLayout,
         useCallback as useMemoizedCallback,
         useMemo as useMemoizedValue,
         useImperativeHandle as useHandle,
       } from "react";
       export const useTrackedValue = (value, ref) => {
         effect(() => console.log(value), []);
         useLayout(() => console.log(value), []);
         const callback = useMemoizedCallback(() => value, []);
         const memoizedValue = useMemoizedValue(() => value, []);
         useHandle(ref, () => ({ value }), []);
         return { callback, memoizedValue };
       };`,
    );
    expect(result.diagnostics).toHaveLength(5);
  });

  it("flags a renamed React useEffectEvent inside an unconditional custom hook wrapper", () => {
    const result = runRule(
      hookImportRenameLosesUsePrefix,
      `import { useEffectEvent as useEventCallback } from "react";
       export const useTrackedEvent = (value) => {
         const handler = useEventCallback(() => value);
         return handler;
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not require exact names for React hooks without name-specific lint semantics", () => {
    const result = runRule(
      hookImportRenameLosesUsePrefix,
      `import { useState as useLocalState } from "react";
       export const useCounter = () => useLocalState(0);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not infer hook provenance from an external router package", () => {
    const result = runRule(
      hookImportRenameLosesUsePrefix,
      `import { useNavigate as routerUseNavigate } from "react-router-dom";
       export const useNavigate = (disabled) => {
         if (disabled) return null;
         return routerUseNavigate();
       };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not infer external hook provenance in conditional expressions", () => {
    const result = runRule(
      hookImportRenameLosesUsePrefix,
      `import { useQuery as query } from "@tanstack/react-query";
       export const useQuery = (enabled) => enabled && query();`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not infer external hook provenance in loops", () => {
    const result = runRule(
      hookImportRenameLosesUsePrefix,
      `import { useQuery as query } from "@tanstack/react-query";
       export const useQuery = (keys) => {
         for (const key of keys) query({ queryKey: [key] });
       };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not infer external hook provenance inside try blocks", () => {
    const result = runRule(
      hookImportRenameLosesUsePrefix,
      `import { useQuery as query } from "@tanstack/react-query";
       export const useQuery = () => {
         try {
           return query();
         } catch {
           return null;
         }
       };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an alias called from multiple unconditional hook wrappers", () => {
    const result = runRule(
      hookImportRenameLosesUsePrefix,
      `import { useQuery as query } from "@tanstack/react-query";
       export const useQuery = () => query();
       export const useProducts = () => query({ queryKey: ["products"] });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not infer external hook provenance from mixed call sites", () => {
    const result = runRule(
      hookImportRenameLosesUsePrefix,
      `import { useQuery as query } from "@tanstack/react-query";
       export const useQuery = () => query();
       export const Products = () => query({ queryKey: ["products"] });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a renamed hook imported from a relative local module", () => {
    const result = runRule(
      hookImportRenameLosesUsePrefix,
      `import { useProject as project } from "./use-project";
       export const Project = () => project();`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag aliases in bundled output", () => {
    const result = runRule(
      hookImportRenameLosesUsePrefix,
      `import { useState as s } from "react";
       export const Counter = () => s(0);`,
      { filename: "/repo/dist/index.js" },
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
