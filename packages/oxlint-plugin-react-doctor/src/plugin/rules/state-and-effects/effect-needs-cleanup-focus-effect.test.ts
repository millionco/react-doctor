import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { effectNeedsCleanup } from "./effect-needs-cleanup.js";

const runCleanup = (source: string) => runRule(effectNeedsCleanup, source);

describe.each(["expo-router", "@react-navigation/native"])("focus effects from %s", (source) => {
  it.each(["inline", "inline-memoized", "typed-memoized", "memoized", "named", "declared"])(
    "owns returned cleanup for %s callbacks",
    (form) => {
      for (const clean of [false, true]) {
        const callback = `() => { const subscription = BackHandler.addEventListener('hardwareBackPress', () => true); ${clean ? "return () => subscription.remove();" : ""} }`;
        const binding = form === "memoized" ? `useCallback(${callback}, [])` : callback;
        let invocation = `useFocusEffect(${callback});`;
        if (form === "inline-memoized")
          invocation = `useFocusEffect(useCallback(${callback}, []));`;
        if (form === "typed-memoized")
          invocation = `useFocusEffect(useCallback((${callback}) as (() => void), []));`;
        if (form === "memoized" || form === "named")
          invocation = `const callback = ${binding}; useFocusEffect(callback);`;
        if (form === "declared")
          invocation = `function callback() ${callback.slice(callback.indexOf("{"))} useFocusEffect(callback);`;
        const result = runCleanup(
          `import { useCallback } from 'react'; import { useFocusEffect } from '${source}'; import { BackHandler } from 'react-native'; export const Screen = () => { ${invocation} return null; };`,
        );
        expect(result.parseErrors).toEqual([]);
        expect(result.diagnostics).toHaveLength(clean ? 0 : 1);
      }
    },
  );

  it.each([
    { imports: `import { useFocusEffect as focus } from '${source}';`, callee: "focus" },
    { imports: `import * as Navigation from '${source}';`, callee: "Navigation.useFocusEffect" },
    {
      imports: `import { useFocusEffect } from '${source}'; const focus = useFocusEffect;`,
      callee: "focus",
    },
  ])("resolves hook imports: $callee", ({ imports, callee }) => {
    const result = runCleanup(
      `${imports} import { useCallback } from 'react'; export const Screen = () => { ${callee}(useCallback(() => { const timer = setTimeout(work, 100); }, [])); return null; };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not let focus ownership hide leaks through other consumers", () => {
    const result = runCleanup(
      `import { useCallback } from 'react'; import { useFocusEffect } from '${source}'; import { BackHandler } from 'react-native'; export const Screen = () => { const callback = useCallback(() => { const subscription = BackHandler.addEventListener('hardwareBackPress', () => true); return () => subscription.remove(); }, []); useFocusEffect(callback); return <button onClick={callback} />; };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("requires cleanup on every path and for every handle", () => {
    const result = runCleanup(
      `import { useCallback } from 'react'; import { useFocusEffect } from '${source}'; export const Screen = ({ enabled }) => { useFocusEffect(useCallback(() => { const first = setInterval(work, 100); const second = setInterval(work, 100); if (enabled) return () => clearInterval(first); }, [enabled])); return null; };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts timer cleanup from an inline memoized callback", () => {
    const result = runCleanup(
      `import { useCallback } from 'react'; import { useFocusEffect } from '${source}'; export const Screen = () => { useFocusEffect(useCallback(() => { const timer = setInterval(work, 100); return () => clearInterval(timer); }, [])); return null; };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});

describe("focus hook binding boundaries", () => {
  it.each([
    { imports: "import { useFocusEffect } from 'unrelated';", params: "" },
    { imports: "import { useFocusEffect } from 'expo-router';", params: "{ useFocusEffect }" },
  ])(
    "does not assume an unrelated or shadowed hook owns cleanup: $imports",
    ({ imports, params }) => {
      const result = runCleanup(
        `import { useCallback } from 'react'; ${imports} import { BackHandler } from 'react-native'; export const Screen = (${params}) => { const callback = useCallback(() => { const subscription = BackHandler.addEventListener('hardwareBackPress', handler); return () => subscription.remove(); }, []); useFocusEffect(callback); return null; };`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    },
  );
});
