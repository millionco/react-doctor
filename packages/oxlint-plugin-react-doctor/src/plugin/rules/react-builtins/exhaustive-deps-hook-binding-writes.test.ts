import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { exhaustiveDeps } from "./exhaustive-deps.js";

describe("react-builtins/exhaustive-deps Hook binding writes", () => {
  it.each([
    [
      "state setter array target",
      "let [value, setValue] = useState(0); [setValue] = replacements;",
      "setValue(1)",
      "setValue",
    ],
    [
      "state setter object target",
      "let [value, setValue] = useState(0); ({ callback: setValue } = replacements);",
      "setValue(1)",
      "setValue",
    ],
    [
      "state setter TypeScript target",
      "let [value, setValue] = useState(0); (setValue as (() => void)) = replacements.callback;",
      "setValue(1)",
      "setValue",
    ],
    [
      "reducer dispatch target",
      "let [value, dispatch] = useReducer((previous) => previous + 1, 0); [dispatch] = replacements;",
      "dispatch()",
      "dispatch",
    ],
    [
      "ref nested target",
      "let reference = useRef(null); ({ holder: [reference] } = replacements);",
      "console.log(reference.current)",
      "reference",
    ],
    [
      "memoized callback array target",
      "let callback = useCallback(() => 0, []); [callback] = replacements;",
      "callback()",
      "callback",
    ],
    [
      "memoized callback non-null target",
      "let callback = useCallback(() => 0, []); callback! = replacements.callback;",
      "callback()",
      "callback",
    ],
    [
      "memoized value object target",
      "let memoized = useMemo(() => ({ value: 0 }), []); ({ memoized } = replacements);",
      "console.log(memoized.value)",
      "memoized",
    ],
    [
      "memoized value loop target",
      "let memoized = useMemo(() => 0, []); for (memoized of replacements) break;",
      "console.log(memoized)",
      "memoized",
    ],
    [
      "local function capturing a rebound setter",
      `let [value, setValue] = useState(0);
      ({ callback: setValue } = replacements);
      const reset = () => setValue(1);`,
      "reset()",
      "reset",
    ],
  ])("requires a dependency for %s", (_name, declaration, operation, dependency) => {
    const result = runRule(
      exhaustiveDeps,
      `import { useEffect, useState, useReducer, useRef, useCallback, useMemo } from "react";
      const Widget = ({ replacements }) => {
        ${declaration}
        useEffect(() => { ${operation}; }, []);
        return null;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain(dependency);
  });

  it.each([
    [
      "state setter after writing the state binding",
      "let [value, setValue] = useState(0); [value] = replacements;",
      "setValue(1)",
    ],
    [
      "setter with a shadowed parameter assignment",
      `const [value, setValue] = useState(0);
      const replace = (setValue) => { [setValue] = replacements; };
      replace(() => 0);`,
      "setValue(1)",
    ],
    ["read-only ref", "let reference = useRef(null);", "console.log(reference.current)"],
    [
      "ref property assignment",
      "const reference = useRef(null); reference.current = replacements;",
      "console.log(reference.current)",
    ],
    [
      "destructuring into a ref property",
      "const reference = useRef(null); ({ value: reference.current } = replacements);",
      "console.log(reference.current)",
    ],
    ["read-only memoized callback", "let callback = useCallback(() => 0, []);", "callback()"],
    [
      "memoized callback property assignment",
      "const callback = useCallback(() => 0, []); callback.description = replacements;",
      "callback()",
    ],
    ["read-only memoized value", "let memoized = useMemo(() => 0, []);", "console.log(memoized)"],
  ])("preserves stable %s", (_name, declaration, operation) => {
    const result = runRule(
      exhaustiveDeps,
      `import { useEffect, useState, useRef, useCallback, useMemo } from "react";
      const Widget = ({ replacements }) => {
        ${declaration}
        useEffect(() => { ${operation}; }, []);
        return null;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("requires the replacement ref instead of classifying its current dependency as stable", () => {
    const result = runRule(
      exhaustiveDeps,
      `import { useEffect, useRef } from "react";
      const Widget = ({ replacements }) => {
        let reference = useRef(null);
        [reference] = replacements;
        useEffect(() => { console.log(reference.current); }, [reference.current]);
        return null;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("stale `reference`");
  });

  it("still reports a current-value dependency for a stable ref binding", () => {
    const result = runRule(
      exhaustiveDeps,
      `import { useEffect, useRef } from "react";
      const Widget = () => {
        const reference = useRef(null);
        useEffect(() => { console.log(reference.current); }, [reference.current]);
        return null;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("reference.current");
  });
});
