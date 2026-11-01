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

describe("runtime imported provider reference attribution", () => {
  it.each([
    { name: "baseline", prefix: "", expected: 1 },
    {
      name: "Group-direct",
      prefix: "const rewriteProvider=()=>{ mutate(Group);}; rewriteProvider();",
      expected: 0,
    },
    {
      name: "Group-interface",
      prefix: "const rewriteProvider=()=>{interface Group {} mutate(Group);}; rewriteProvider();",
      expected: 0,
    },
    {
      name: "Group-typealias",
      prefix: "const rewriteProvider=()=>{type Group=unknown; mutate(Group);}; rewriteProvider();",
      expected: 0,
    },
    {
      name: "useRef-direct",
      prefix: "const rewriteProvider=()=>{ mutate(useRef);}; rewriteProvider();",
      expected: 0,
    },
    {
      name: "useRef-interface",
      prefix: "const rewriteProvider=()=>{interface useRef {} mutate(useRef);}; rewriteProvider();",
      expected: 0,
    },
    {
      name: "useRef-typealias",
      prefix:
        "const rewriteProvider=()=>{type useRef=unknown; mutate(useRef);}; rewriteProvider();",
      expected: 0,
    },
  ])("preserves runtime exposure: $name", ({ prefix, expected }) => {
    const result = runRule(noRefCurrentInRender, prefix + "\n" + source, options);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  });
});
