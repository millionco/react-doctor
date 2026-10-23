import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { exhaustiveDeps } from "./exhaustive-deps.js";

const runTuple = (
  factory: string,
  declaration = "const [begin, finish] = useMemo(makePair, []);",
  capability = "",
) =>
  runRule(
    exhaustiveDeps,
    `
    import React, { useEffect, useMemo } from "react";
    ${capability}
    ${factory}
    export const Panel = ({ value }) => {
      ${declaration}
      useEffect(() => () => finish(), []);
      return useMemo(() => () => begin(), []);
    };
  `,
  );

describe("exhaustive-deps memoized tuple callbacks", () => {
  it.each([
    ["direct arrow slots", "const makePair = () => [() => 1, () => 0];"],
    [
      "local arrow slots",
      "const makePair = () => { const first = () => 1; const last = () => 0; return [first, last]; };",
    ],
    [
      "mutable factory resources",
      "const makePair = () => { let token = 0; const cancel = () => { token = 0; }; return [() => { token += 1; }, cancel]; };",
    ],
    [
      "server branch local callbacks",
      "const makePair = () => { if (typeof window === 'undefined') { const empty = () => {}; return [empty, empty]; } let handle; const cancel = () => window.clearTimeout(handle); return [() => { handle = window.setTimeout(cancel, 1); }, cancel]; };",
    ],
    [
      "unrelated local native names",
      "const makePair = () => [() => 1, () => 0];",
      "const Array = { label: 'local' }; const label = Array.label;",
    ],
    [
      "erased capability annotations",
      "const makePair = () => [() => 1, () => 0];",
      "interface Array { readonly value: string; } type Reflect = { value: string };",
    ],
  ])("accepts %s under the existing memo policy", (_description, factory, capability?: string) => {
    expect(runTuple(factory, undefined, capability)).toEqual({ diagnostics: [], parseErrors: [] });
  });

  it.each([
    [
      "changing memo dependencies",
      "const makePair = () => [() => 1, () => 0];",
      "const [begin, finish] = useMemo(makePair, [value]);",
    ],
    [
      "writable projected bindings",
      "const makePair = () => [() => 1, () => 0];",
      "let [begin, finish] = useMemo(makePair, []); [begin, finish] = value;",
    ],
    [
      "default bindings",
      "const makePair = () => [() => 1, () => 0];",
      "const [begin = value, finish = value] = useMemo(makePair, []);",
    ],
    [
      "cached array aliases",
      "const makePair = () => [() => 1, () => 0];",
      "const pair = useMemo(makePair, []); const [begin, finish] = pair;",
    ],
    [
      "aliased return arrays",
      "const makePair = () => { const pair = [() => 1, () => 0]; retain(pair); return pair; };",
    ],
    [
      "getter slots",
      "const makePair = () => ({ get 0() { return () => 1; }, get 1() { return () => 0; } });",
    ],
    [
      "custom iterators",
      "const makePair = () => ({ [Symbol.iterator]: function* () { yield changing(); yield changing(); } });",
    ],
    ["an unselected hole", "const makePair = () => [, () => 0];"],
    ["spreads", "const makePair = () => [...callbacks];"],
    [
      "inconsistent return shapes",
      "const makePair = () => { if (flag) return [() => 1]; return [() => 1, () => 0]; };",
    ],
    ["opaque slot values", "const makePair = () => [createCallback(), createCallback()];"],
    [
      "writable module factories",
      "let makePair = () => [() => 1, () => 0]; makePair = otherFactory;",
    ],
    [
      "a second factory consumer",
      "const makePair = () => [() => 1, () => 0]; const exposed = makePair();",
    ],
    [
      "useCallback result projection",
      "const makePair = () => [() => 1, () => 0];",
      "const [begin, finish] = React.useCallback(makePair, []);",
    ],
  ])("keeps dependency warnings for %s", (_description, factory, declaration?: string) => {
    const result = runTuple(factory, declaration);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.some((diagnostic) => diagnostic.message.includes("`begin`"))).toBe(
      true,
    );
    expect(result.diagnostics.some((diagnostic) => diagnostic.message.includes("`finish`"))).toBe(
      true,
    );
  });

  it.each([
    ["React provider replacement", "React.useMemo = replacement;"],
    ["native array iterator replacement", "Array.prototype[Symbol.iterator] = replacement;"],
    ["reflective capability", "const inspect = Reflect.get;"],
    ["global array alias", "const NativeArray = globalThis.Array;"],
    [
      "a resolved global capability key",
      "const key = 'Object'; const reflection = globalThis[key];",
    ],
    ["dynamic code capability", "const evaluate = eval;"],
    ["Node loader capability", "import { createRequire } from 'node:module';"],
    ["unknown computed capability", "const selected = window[value];"],
    ["erased name used at runtime", "interface Array { value: string; } const native = Array;"],
  ])("declines the native role with %s", (_description, capability) => {
    const result = runTuple("const makePair = () => [() => 1, () => 0];", undefined, capability);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("retains callback property dependencies", () => {
    const result = runRule(
      exhaustiveDeps,
      `import { useMemo, useEffect } from "react";
      const makePair = () => [() => 1];
      const Panel = () => { const [callback] = useMemo(makePair, []); useEffect(() => consume(callback.current), []); return null; };
    `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("`callback`");
  });
});
