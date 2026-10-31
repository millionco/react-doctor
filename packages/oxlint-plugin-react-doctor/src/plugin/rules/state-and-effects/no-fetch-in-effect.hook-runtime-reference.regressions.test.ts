import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noFetchInEffect } from "./no-fetch-in-effect.js";

const source =
  'import { useCallback, useEffect, useState } from "react";\nconst SearchPanel = ({ query }) => {\nconst [rows, setRows] = useState([]);\nconst load = useCallback(async (value) => { const response = await fetch("/api/items?key=" + value); const data = await response.json(); setRows(data); }, []);\nuseEffect(() => { load(query); }, [query, load]);\nreturn null;\n};\n';
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
      name: "useCallback-direct",
      prefix: "const rewriteProvider=()=>{ mutate(useCallback);}; rewriteProvider();",
      expected: 0,
    },
    {
      name: "useCallback-interface",
      prefix:
        "const rewriteProvider=()=>{interface useCallback {} mutate(useCallback);}; rewriteProvider();",
      expected: 0,
    },
    {
      name: "useCallback-typealias",
      prefix:
        "const rewriteProvider=()=>{type useCallback=unknown; mutate(useCallback);}; rewriteProvider();",
      expected: 0,
    },
    {
      name: "useEffect-direct",
      prefix: "const rewriteProvider=()=>{ mutate(useEffect);}; rewriteProvider();",
      expected: 0,
    },
    {
      name: "useEffect-interface",
      prefix:
        "const rewriteProvider=()=>{interface useEffect {} mutate(useEffect);}; rewriteProvider();",
      expected: 0,
    },
    {
      name: "useEffect-typealias",
      prefix:
        "const rewriteProvider=()=>{type useEffect=unknown; mutate(useEffect);}; rewriteProvider();",
      expected: 0,
    },
  ])("preserves runtime exposure: $name", ({ prefix, expected }) => {
    const result = runRule(noFetchInEffect, prefix + "\n" + source, options);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  });
});
