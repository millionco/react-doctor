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

describe("prefer-module-scope-static-value erased namespace providers", () => {
  it.each([
    { name: "direct", prefix: "require('react').useRef = () => null;", expected: 1 },
    {
      name: "empty",
      prefix: "namespace require {} require('react').useRef = () => null;",
      expected: 1,
    },
    {
      name: "type-only",
      prefix:
        "namespace require { export interface Marker {} } require('react').useRef = () => null;",
      expected: 1,
    },
    {
      name: "nested",
      prefix:
        "namespace require { export namespace Inner { export type Marker = unknown; } } require('react').useRef = () => null;",
      expected: 1,
    },
    {
      name: "runtime",
      prefix:
        "namespace require { export const marker = 0; } require('react').useRef = () => null;",
      expected: 0,
    },
  ])("preserves emitted binding: $name", ({ prefix, expected }) => {
    const result = runRule(preferModuleScopeStaticValue, prefix + "\n" + source, options);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  });
});
