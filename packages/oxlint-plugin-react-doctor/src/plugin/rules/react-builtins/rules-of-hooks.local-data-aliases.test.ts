import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rulesOfHooks } from "./rules-of-hooks.js";

describe("rules-of-hooks immutable local data aliases", () => {
  it.each([
    {
      name: "constant-return",
      source:
        'const read = () => "Ready"; const useLabel = read; async function update() { return useLabel(); }',
      expected: 0,
    },
    {
      name: "own-parameter",
      source:
        'const read = (value) => value; const useLabel = read; async function update(value) { return useLabel("Ready"); }',
      expected: 0,
    },
    {
      name: "const-chain",
      source:
        'const read = (value) => value; const intermediate = read; const useLabel = intermediate; async function update(value) { return useLabel("Ready"); }',
      expected: 0,
    },
    {
      name: "string-concatenation",
      source:
        'const read = (value) => value + "!"; const useLabel = read; async function update() { return useLabel("Hi"); }',
      expected: 0,
    },
    {
      name: "scalar-arithmetic",
      source:
        "const read = (value) => (value + 1) * 2; const useLabel = read; async function update() { const input = 2; return useLabel(input); }",
      expected: 0,
    },
    {
      name: "scalar-interpolation",
      source:
        "const read = (value) => `#${value}`; const useLabel = read; async function update() { return useLabel(4); }",
      expected: 0,
    },
    {
      name: "non-coercive-equality",
      source:
        'const read = (value) => value === "Ready"; const useLabel = read; async function update(value) { return useLabel(value); }',
      expected: 0,
    },
    {
      name: "non-coercive-operator",
      source:
        'const read = (value) => typeof value === "string" ? !value : false; const useLabel = read; async function update(value) { return useLabel(value); }',
      expected: 0,
    },
    {
      name: "data-object",
      source:
        'const read = (value) => ({ value }); const useLabel = read; async function update(value) { return useLabel("Ready"); }',
      expected: 0,
    },
    {
      name: "call-conditional",
      source:
        "const read = (value) => value; const useLabel = read; function Panel({ ok }) { if (ok) useLabel(1); return null; }",
      expected: 0,
    },
    {
      name: "factory-hook-count",
      source:
        'import { useState } from "react"; const read = (value) => value; const useLabel = read; function createPanel() { const [value] = useState(0); return useLabel(0); }',
      expected: 1,
    },
    {
      name: "mutable-target",
      source:
        'let read = () => "Ready"; const useLabel = read; async function update() { return useLabel(); }',
      expected: 1,
    },
    {
      name: "mutable-alias",
      source:
        'const read = () => "Ready"; let useLabel = read; async function update() { return useLabel(); }',
      expected: 1,
    },
    {
      name: "opaque-coercion",
      source:
        "const read = (value) => +value; const useLabel = read; async function update(value) { return useLabel(value); }",
      expected: 1,
    },
    {
      name: "opaque-interpolation",
      source:
        "const read = (value) => `${value}`; const useLabel = read; async function update(value) { return useLabel(value); }",
      expected: 1,
    },
    {
      name: "spread-shifts-primitive",
      source:
        "const read = (value) => +value; const useLabel = read; async function update(value) { return useLabel(...[value], 0); }",
      expected: 1,
    },
    {
      name: "erased-this-parameter",
      source:
        "const read = function(this: void, value: unknown) { return +value; }; const useLabel = read; async function update(value) { return useLabel(value, 0); }",
      expected: 1,
    },
    {
      name: "getter-read",
      source:
        "const read = (value) => value.text; const useLabel = read; async function update(value) { return useLabel(value); }",
      expected: 1,
    },
    {
      name: "default-expression",
      source:
        "const read = (value=opaque()) => value; const useLabel = read; async function update() { return useLabel(); }",
      expected: 1,
    },
    {
      name: "destructuring-getter",
      source:
        "const read = ({value}) => value; const useLabel = read; async function update(model) { return useLabel(model); }",
      expected: 1,
    },
    {
      name: "typeof-call",
      source:
        "const read = () => typeof hidden(); const useLabel = read; async function update() { return useLabel(); }",
      expected: 1,
    },
    {
      name: "branch-call",
      source:
        "const read = (value) => value && hidden(); const useLabel = read; async function update(value) { return useLabel(value); }",
      expected: 1,
    },
    {
      name: "object-spread",
      source:
        "const read = (value) => ({...value}); const useLabel = read; async function update(value) { return useLabel(value); }",
      expected: 1,
    },
    {
      name: "in-proxy-trap",
      source:
        'const read = (value) => "text" in value; const useLabel = read; async function update(value) { return useLabel(value); }',
      expected: 1,
    },
    {
      name: "react-hook-alias",
      source:
        'import { useState } from "react"; const read = () => useState(0); const useLabel = read; async function update() { return useLabel(); }',
      expected: 2,
    },
    {
      name: "transitive-hook-alias",
      source:
        'import { useState } from "react"; const state = () => useState(0); const read = () => state(); const useLabel = read; async function update() { return useLabel(); }',
      expected: 2,
    },
    {
      name: "opaque-import",
      source:
        'import { read } from "./local"; const useLabel = read; async function update() { return useLabel(); }',
      expected: 1,
    },
    {
      name: "direct-hook-forwarding",
      source:
        'import { useState } from "react"; const read = (value) => value; const useLabel = read; async function update() { return useLabel(useState)(0); }',
      expected: 1,
    },
    {
      name: "stored-hook-forwarding",
      source:
        'import { useState } from "react"; const read = (value) => value; const useLabel = read; async function update() { const fn = useLabel(useState); return fn(0); }',
      expected: 1,
    },
    {
      name: "aggregate-hook-forwarding",
      source:
        'import { useState } from "react"; const read = (value) => ({ value }); const useLabel = read; async function update() { return useLabel(useState).value(0); }',
      expected: 1,
    },
    {
      name: "nested-real-hook-call",
      source:
        'import { useState } from "react"; const read = (value) => !value; const useLabel = read; async function update() { return useLabel(useState(0)); }',
      expected: 1,
    },
    {
      name: "computed-object-key",
      source:
        "const read = (value) => ({ [value]: 1 }); const useLabel = read; async function update(value) { return useLabel(value); }",
      expected: 1,
    },
    {
      name: "object-getter",
      source:
        "const read = () => ({ get label() { return opaque(); } }); const useLabel = read; async function update() { return useLabel().label; }",
      expected: 1,
    },
    {
      name: "unreachable-conditional-self-reference",
      source:
        "const input = true ? 1 : input; const read = (value) => +value; const useLabel = read; async function update() { return useLabel(input); }",
      expected: 0,
    },
    {
      name: "unreachable-logical-self-reference",
      source:
        'const input = "Ready" || input; const read = (value) => value + "!"; const useLabel = read; async function update() { return useLabel(input); }',
      expected: 0,
    },
    {
      name: "cyclic-evaluation",
      source:
        "const input = +input; const read = (value) => value + 1; const useLabel = read; async function update() { return useLabel(input); }",
      expected: 1,
    },
    {
      name: "regexp-value-can-coerce",
      source:
        "const input = /ready/ || 0; const read = (value) => +value; const useLabel = read; async function update() { return useLabel(input); }",
      expected: 1,
    },
  ])("$name", ({ source, expected }) => {
    const result = runRule(rulesOfHooks, source, { forceJsx: true });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
    if (source.includes("function createPanel") || source.includes("useLabel(useState(0))")) {
      expect(result.diagnostics[0]?.message).toContain("useState");
    }
  });
});
