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

describe("no-fetch-in-effect erased providers", () => {
  it.each([
    { prefix: "", expected: 1 },
    { prefix: "globalThis.require('react').useCallback = callback => () => {};", expected: 0 },
    {
      prefix:
        "declare const globalThis: any; globalThis.require('react').useCallback = callback => () => {};",
      expected: 0,
    },
    {
      prefix:
        "interface globalThis {} globalThis.require('react').useCallback = callback => () => {};",
      expected: 0,
    },
    {
      prefix:
        "import type globalThis from \"carrier\"; globalThis.require('react').useCallback = callback => () => {};",
      expected: 0,
    },
    { prefix: "declare const globalThis: unknown;", expected: 1 },
    { prefix: "interface globalThis {}", expected: 1 },
    { prefix: 'import type globalThis from "carrier";', expected: 1 },
  ])("preserves provider uncertainty: $prefix", ({ prefix, expected }) => {
    const result = runRule(noFetchInEffect, prefix + "\n" + source, options);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  });
});
