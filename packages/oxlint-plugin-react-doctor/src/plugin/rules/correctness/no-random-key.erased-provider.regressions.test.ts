import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noRandomKey } from "./no-random-key.js";

const source =
  '// rule: no-random-key\n// weakness: local-resource-origin\n// source: independently synthetic local resource key\n// verdict: fail\nimport { v4 as makeKey } from "uuid";\nconst makeCards = () => [{ token: makeKey(), label: "Ready" }];\nconst Cards = () => {\n  const cards = makeCards();\n  return (\n    <>\n      {cards.map((card) => (\n        <span key={card.token}>{card.label}</span>\n      ))}\n    </>\n  );\n};\nexport const Example = () => <Cards />;\n';
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

describe("no-random-key erased providers", () => {
  it.each([
    { prefix: "", expected: 1 },
    { prefix: "globalThis.require('uuid').v4 = () => 'stable';", expected: 0 },
    {
      prefix: "declare const globalThis: any; globalThis.require('uuid').v4 = () => 'stable';",
      expected: 0,
    },
    {
      prefix: "interface globalThis {} globalThis.require('uuid').v4 = () => 'stable';",
      expected: 0,
    },
    {
      prefix:
        "import type globalThis from \"carrier\"; globalThis.require('uuid').v4 = () => 'stable';",
      expected: 0,
    },
    { prefix: "declare const globalThis: unknown;", expected: 1 },
    { prefix: "interface globalThis {}", expected: 1 },
    { prefix: 'import type globalThis from "carrier";', expected: 1 },
  ])("preserves provider uncertainty: $prefix", ({ prefix, expected }) => {
    const result = runRule(noRandomKey, prefix + "\n" + source, options);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  });
});
