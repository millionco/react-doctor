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

describe("no-fetch-in-effect runtime provider bindings", () => {
  it.each([
    { name: "baseline", prefix: "", expected: 1 },
    { name: "direct", prefix: "require('react').useCallback = callback => () => {};", expected: 0 },
    {
      name: "type-import-equals",
      prefix:
        "import type require = require('provider-types'); require('react').useCallback = callback => () => {};",
      expected: 0,
    },
    {
      name: "local",
      prefix:
        "const require = (_source: string) => ({useCallback: (callback: unknown) => callback}); require('react').useCallback = callback => () => {};",
      expected: 1,
    },
    {
      name: "local-interface",
      prefix:
        "const require = (_source: string) => ({useCallback: (callback: unknown) => callback}); interface require {} require('react').useCallback = callback => () => {};",
      expected: 1,
    },
    {
      name: "interface-local",
      prefix:
        "interface require {} const require = (_source: string) => ({useCallback: (callback: unknown) => callback}); require('react').useCallback = callback => () => {};",
      expected: 1,
    },
    {
      name: "outer-local-inner-interface",
      prefix:
        "const require = (_source: string) => ({useCallback: (callback: unknown) => callback}); function localLoader() { interface require {} require('react').useCallback = callback => () => {}; }",
      expected: 1,
    },
    {
      name: "value-import-equals",
      prefix:
        "import require = require('provider-types'); require('react').useCallback = callback => () => {};",
      expected: 0,
    },
  ])("preserves runtime binding: $name", ({ prefix, expected }) => {
    const result = runRule(noFetchInEffect, prefix + "\n" + source, options);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  });
});
