import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { hookImportRenameLosesUsePrefix } from "./hook-import-rename-loses-use-prefix.js";

describe("hook-import-rename-loses-use-prefix", () => {
  it("flags a useQuery alias that drops the use prefix and is called", () => {
    const result = runRule(
      hookImportRenameLosesUsePrefix,
      `import { useQuery as getProducts } from "@tanstack/react-query";
       const Products = () => {
         const products = getProducts();
         return null;
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
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

  it("flags a third-party hook rename that is called", () => {
    const result = runRule(
      hookImportRenameLosesUsePrefix,
      `import { useFormik as formik } from "formik";
       const Form = () => {
         const formikBag = formik({ initialValues: {} });
         return null;
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
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

  it("flags a digit-named hook rename that loses the use prefix (react-div-100vh's use100vh)", () => {
    const result = runRule(
      hookImportRenameLosesUsePrefix,
      `import { use100vh as viewportHeight } from "react-div-100vh";
       const Panel = () => {
         const height = viewportHeight();
         return null;
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
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

  it("flags a same-name wrapper that calls the alias after an early return", () => {
    const result = runRule(
      hookImportRenameLosesUsePrefix,
      `import { useNavigate as routerUseNavigate } from "react-router-dom";
       export const useNavigate = (disabled) => {
         if (disabled) return null;
         return routerUseNavigate();
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags same-name wrappers with conditional-expression alias calls", () => {
    const result = runRule(
      hookImportRenameLosesUsePrefix,
      `import { useQuery as query } from "@tanstack/react-query";
       export const useQuery = (enabled) => enabled && query();`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags same-name wrappers with looped alias calls", () => {
    const result = runRule(
      hookImportRenameLosesUsePrefix,
      `import { useQuery as query } from "@tanstack/react-query";
       export const useQuery = (keys) => {
         for (const key of keys) query({ queryKey: [key] });
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags same-name wrappers with alias calls inside try blocks", () => {
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
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an alias that is also called outside its same-name wrapper", () => {
    const result = runRule(
      hookImportRenameLosesUsePrefix,
      `import { useQuery as query } from "@tanstack/react-query";
       export const useQuery = () => query();
       export const useProducts = () => query({ queryKey: ["products"] });`,
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
