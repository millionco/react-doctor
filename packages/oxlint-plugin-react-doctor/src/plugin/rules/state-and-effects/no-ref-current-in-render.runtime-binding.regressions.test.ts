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

describe("no-ref-current-in-render runtime provider bindings", () => {
  it.each([
    { name: "baseline", prefix: "", expected: 1 },
    { name: "direct", prefix: "require('three').Group = class {};", expected: 0 },
    {
      name: "type-import-equals",
      prefix: "import type require = require('provider-types'); require('three').Group = class {};",
      expected: 0,
    },
    {
      name: "local",
      prefix:
        "const require = (_source: string) => ({Group: () => null}); require('three').Group = class {};",
      expected: 0,
    },
    {
      name: "local-interface",
      prefix:
        "const require = (_source: string) => ({Group: () => null}); interface require {} require('three').Group = class {};",
      expected: 0,
    },
    {
      name: "interface-local",
      prefix:
        "interface require {} const require = (_source: string) => ({Group: () => null}); require('three').Group = class {};",
      expected: 0,
    },
    {
      name: "outer-local-inner-interface",
      prefix:
        "const require = (_source: string) => ({Group: () => null}); function localLoader() { interface require {} require('three').Group = class {}; }",
      expected: 0,
    },
    {
      name: "value-import-equals",
      prefix: "import require = require('provider-types'); require('three').Group = class {};",
      expected: 0,
    },
  ])("preserves runtime binding: $name", ({ prefix, expected }) => {
    const result = runRule(noRefCurrentInRender, prefix + "\n" + source, options);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  });
});
