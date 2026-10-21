import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noRefCurrentInRender } from "./no-ref-current-in-render.js";

const run = (code: string) =>
  runRule(noRefCurrentInRender, code, { includeLocations: true }).diagnostics;

describe("nested ref writes during render", () => {
  it.each([
    ["object member", "{}", "cache.current.value = value"],
    ["array index", "[]", "cache.current[0] = value"],
    ["dynamic index", "[]", "cache.current[value] = value"],
    ["computed current", "{}", "cache['current'].value = value"],
    ["wrapped receiver", "{}", "(cache.current).value = value"],
    ["compound assignment", "{ count: 0 }", "cache.current.count += value"],
    ["increment", "{ count: 0 }", "cache.current.count++"],
    ["decrement", "[0]", "--cache.current[0]"],
  ])("reports a %s write", (_name, initialValue, write) => {
    const diagnostics = run(`import { useRef } from 'react';
      const Panel = ({ value }) => {
        const cache = useRef(${initialValue});
        ${write};
        return null;
      };`);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.line).toBe(4);
  });

  it.each([
    [
      "React namespace",
      "import * as React from 'react';",
      "React.useRef",
      "cache.current.value = value",
    ],
    [
      "import alias",
      "import { useRef as makeRef } from 'react';",
      "makeRef",
      "cache.current.value = value",
    ],
    [
      "const ref alias",
      "import { useRef } from 'react';",
      "useRef",
      "const alias = cache; alias.current.value = value",
    ],
  ])("preserves %s identity", (_name, imports, hook, write) => {
    expect(
      run(`${imports}
      const Panel = ({ value }) => {
        const cache = ${hook}({});
        ${write};
        return null;
      };`),
    ).toHaveLength(1);
  });

  it("reports an array callback invoked by a render memo", () => {
    expect(
      run(`import { useRef, useMemo } from 'react';
      const Panel = ({ values }) => {
        const cache = useRef([]);
        return useMemo(() => values.map((value, index) => {
          cache.current[index] = value;
          return <span key={index}>{value}</span>;
        }), [values]);
      };`),
    ).toHaveLength(1);
  });

  it.each([
    ["effect", "useEffect(() => { cache.current.value = value; }, [value]);"],
    ["layout effect", "useLayoutEffect(() => { cache.current.value = value; }, [value]);"],
    ["event handler", "return <button onClick={() => { cache.current.value = value; }} />;"],
    ["uncalled helper", "const update = () => { cache.current.value = value; };"],
    ["memoized callback", "useCallback(() => { cache.current.value = value; }, [value]);"],
    ["timer callback", "setTimeout(() => { cache.current.value = value; }, 0);"],
    ["read only", "return <span>{cache.current.value}</span>;"],
    ["fresh copy", "const copy = { ...cache.current }; copy.value = value;"],
    ["property named ref", "const local = { cache }; local.value = value;"],
  ])("does not report %s", (_name, body) => {
    expect(
      run(`import { useRef, useEffect, useLayoutEffect, useCallback } from 'react';
      const Panel = ({ value }) => {
        const cache = useRef({});
        ${body}
      };`),
    ).toHaveLength(0);
  });

  it.each([
    "const cache = { current: {} }; cache.current.value = value;",
    "const useRef = (value) => ({ current: value }); const cache = useRef({}); cache.current.value = value;",
    "const cache = useRef({}); const update = (cache) => { cache.current.value = value; }; update({ current: {} });",
    "let cache = useRef({}); cache = { current: {} }; cache.current.value = value;",
    "let cache = useRef({}); [cache] = [{ current: {} }]; cache.current.value = value;",
    "let cache = useRef({}); ({ cache } = { cache: { current: {} } }); cache.current.value = value;",
    "const cache = useRef({ get fresh() { return {}; } }); cache.current.fresh.value = value;",
    "const cache = useRef({ entry: {} }); cache.current.entry.value = value;",
    "const cache = useRef({ set value(next) {} }); cache.current.value = value;",
    "const cache = useRef({ get value() { return 0; } }); cache.current.value = value;",
    "const cache = useRef({ __proto__: { set value(next) {} } }); cache.current.value = value;",
    "const cache = useRef({}); const key = 'unknown'; cache[key].value = value;",
  ])("excludes unproven ref origins: %s", (body) => {
    expect(
      run(`import { useRef } from 'react';
      const Panel = ({ value }) => { ${body} return null; };`),
    ).toHaveLength(0);
  });

  it("keeps predictable null-guarded construction quiet", () => {
    expect(
      run(`import { useRef } from 'react';
      const Panel = () => {
        const cache = useRef(null);
        if (cache.current === null) {
          const initialValue = {};
          initialValue.value = 1;
          cache.current = initialValue;
        }
        return null;
      };`),
    ).toHaveLength(0);
  });
});
