import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noEffectEventHandler } from "./no-effect-event-handler.js";

const source =
  '// rule: no-effect-event-handler\n// verdict: pass\n// weakness: framework-gating\n// source: independently synthetic\n// file-path: src/pages/library.tsx\nimport { useEffect } from "react";\nimport { useRouter } from "next/router";\nexport const getServerSideProps = async () => ({ props: { nextPath: "/library", item: null } });\nconst LibraryPage = ({ nextPath, item }) => {\n  const router = useRouter();\n  useEffect(() => {\n    if (nextPath && !item) {\n      router.replace(nextPath);\n    }\n  }, [nextPath, item]);\n  return null;\n};\nexport default LibraryPage;\n';
const options = {
  filename: "/project/src/pages/library.tsx",
  forceJsx: true,
  settings: {
    "react-doctor": {
      portedRuleMode: "curated",
      rootDirectory: "/project",
      framework: "nextjs",
      capabilities: ["react", "nextjs", "r3f", "react-native"],
    },
    react: { version: "19.0.0" },
  },
};

describe("no-effect-event-handler erased providers", () => {
  it.each([
    { prefix: "", expected: 0 },
    {
      prefix: "globalThis.require('next/router').useRouter = () => ({replace: () => {}});",
      expected: 1,
    },
    {
      prefix:
        "declare const globalThis: any; globalThis.require('next/router').useRouter = () => ({replace: () => {}});",
      expected: 1,
    },
    {
      prefix:
        "interface globalThis {} globalThis.require('next/router').useRouter = () => ({replace: () => {}});",
      expected: 1,
    },
    {
      prefix:
        "import type globalThis from \"carrier\"; globalThis.require('next/router').useRouter = () => ({replace: () => {}});",
      expected: 1,
    },
    { prefix: "declare const globalThis: unknown;", expected: 0 },
    { prefix: "interface globalThis {}", expected: 0 },
    { prefix: 'import type globalThis from "carrier";', expected: 0 },
  ])("preserves provider uncertainty: $prefix", ({ prefix, expected }) => {
    const result = runRule(noEffectEventHandler, prefix + "\n" + source, options);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  });
});
