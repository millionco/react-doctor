import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noRefCurrentInRender } from "./no-ref-current-in-render.js";

const source =
  '// rule: no-ref-current-in-render\n// weakness: library-idiom\n// source: independent synthetic native Group mutation regression\n// verdict: fail\n\nimport { useRef } from "react";\nimport { Group } from "three";\nexport const Badge = () => {\n  const model = useRef(new Group());\n  model.current.position.set(4, 5, 6);\n  return <div />;\n};\n';
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

describe("no-ref-current-in-render erased providers", () => {
  it.each([
    { prefix: "", expected: 1 },
    {
      prefix: "globalThis.Reflect.set(globalThis.require('three'), 'Group', class {});",
      expected: 0,
    },
    {
      prefix:
        "declare const globalThis: any; globalThis.Reflect.set(globalThis.require('three'), 'Group', class {});",
      expected: 0,
    },
    {
      prefix:
        "interface globalThis {} globalThis.Reflect.set(globalThis.require('three'), 'Group', class {});",
      expected: 0,
    },
    {
      prefix:
        "import type globalThis from \"carrier\"; globalThis.Reflect.set(globalThis.require('three'), 'Group', class {});",
      expected: 0,
    },
    { prefix: "declare const globalThis: unknown;", expected: 1 },
    { prefix: "interface globalThis {}", expected: 1 },
    { prefix: 'import type globalThis from "carrier";', expected: 1 },
  ])("preserves provider uncertainty: $prefix", ({ prefix, expected }) => {
    const result = runRule(noRefCurrentInRender, prefix + "\n" + source, options);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  });
});
