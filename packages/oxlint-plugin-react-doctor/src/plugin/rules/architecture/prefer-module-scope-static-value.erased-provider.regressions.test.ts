import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { preferModuleScopeStaticValue } from "./prefer-module-scope-static-value.js";

const source =
  '// rule: prefer-module-scope-static-value\n// verdict: pass\n// weakness: library-idiom\n// source: independently synthetic native Hook initializer\nimport { useRef } from "react";\n\nexport const RefSlots = () => {\n  const slots = { primary: useRef<HTMLDivElement>(null) };\n  return <div ref={slots.primary} />;\n};\n';
const options = {
  filename: "/project/src/view.tsx",
  forceJsx: true,
  settings: {
    "react-doctor": {
      portedRuleMode: "curated",
      rootDirectory: "/project",
      framework: "vite",
      capabilities: ["react", "nextjs", "r3f", "react-native"],
    },
    react: { version: "19.0.0" },
  },
};

describe("prefer-module-scope-static-value erased providers", () => {
  it.each([
    { prefix: "", expected: 0 },
    { prefix: "globalThis.require('react').useRef = () => null;", expected: 1 },
    {
      prefix: "declare const globalThis: any; globalThis.require('react').useRef = () => null;",
      expected: 1,
    },
    {
      prefix: "interface globalThis {} globalThis.require('react').useRef = () => null;",
      expected: 1,
    },
    {
      prefix:
        "import type globalThis from \"carrier\"; globalThis.require('react').useRef = () => null;",
      expected: 1,
    },
    { prefix: "declare const globalThis: unknown;", expected: 0 },
    { prefix: "interface globalThis {}", expected: 0 },
    { prefix: 'import type globalThis from "carrier";', expected: 0 },
  ])("preserves provider uncertainty: $prefix", ({ prefix, expected }) => {
    const result = runRule(preferModuleScopeStaticValue, prefix + "\n" + source, options);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  });
});
