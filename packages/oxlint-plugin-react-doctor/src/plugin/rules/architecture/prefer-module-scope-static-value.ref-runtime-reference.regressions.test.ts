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

describe("runtime imported provider reference attribution", () => {
  it.each([
    { name: "baseline", prefix: "", expected: 0 },
    {
      name: "useRef-direct",
      prefix: "const rewriteProvider=()=>{ mutate(useRef);}; rewriteProvider();",
      expected: 1,
    },
    {
      name: "useRef-interface",
      prefix: "const rewriteProvider=()=>{interface useRef {} mutate(useRef);}; rewriteProvider();",
      expected: 1,
    },
    {
      name: "useRef-typealias",
      prefix:
        "const rewriteProvider=()=>{type useRef=unknown; mutate(useRef);}; rewriteProvider();",
      expected: 1,
    },
  ])("preserves runtime exposure: $name", ({ prefix, expected }) => {
    const result = runRule(preferModuleScopeStaticValue, prefix + "\n" + source, options);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  });
});
