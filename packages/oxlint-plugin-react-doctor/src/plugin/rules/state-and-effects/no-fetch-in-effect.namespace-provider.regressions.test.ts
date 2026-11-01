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

describe("no-fetch-in-effect erased namespace providers", () => {
  it.each([
    { name: "direct", prefix: "require('react').useCallback = callback => () => {};", expected: 0 },
    {
      name: "empty",
      prefix: "namespace require {} require('react').useCallback = callback => () => {};",
      expected: 0,
    },
    {
      name: "type-only",
      prefix:
        "namespace require { export interface Marker {} } require('react').useCallback = callback => () => {};",
      expected: 0,
    },
    {
      name: "nested",
      prefix:
        "namespace require { export namespace Inner { export type Marker = unknown; } } require('react').useCallback = callback => () => {};",
      expected: 0,
    },
    {
      name: "runtime",
      prefix:
        "namespace require { export const marker = 0; } require('react').useCallback = callback => () => {};",
      expected: 0,
    },
  ])("preserves emitted binding: $name", ({ prefix, expected }) => {
    const result = runRule(noFetchInEffect, prefix + "\n" + source, options);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  });
});
