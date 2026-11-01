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

describe("no-effect-event-handler runtime provider bindings", () => {
  it.each([
    { name: "baseline", prefix: "", expected: 0 },
    {
      name: "direct",
      prefix: "require('next/router').useRouter = () => ({replace: () => {}});",
      expected: 1,
    },
    {
      name: "type-import-equals",
      prefix:
        "import type require = require('provider-types'); require('next/router').useRouter = () => ({replace: () => {}});",
      expected: 1,
    },
    {
      name: "local",
      prefix:
        "const require = (_source: string) => ({useRouter: () => ({replace: () => {}})}); require('next/router').useRouter = () => ({replace: () => {}});",
      expected: 0,
    },
    {
      name: "local-interface",
      prefix:
        "const require = (_source: string) => ({useRouter: () => ({replace: () => {}})}); interface require {} require('next/router').useRouter = () => ({replace: () => {}});",
      expected: 0,
    },
    {
      name: "interface-local",
      prefix:
        "interface require {} const require = (_source: string) => ({useRouter: () => ({replace: () => {}})}); require('next/router').useRouter = () => ({replace: () => {}});",
      expected: 0,
    },
    {
      name: "outer-local-inner-interface",
      prefix:
        "const require = (_source: string) => ({useRouter: () => ({replace: () => {}})}); function localLoader() { interface require {} require('next/router').useRouter = () => ({replace: () => {}}); }",
      expected: 0,
    },
    {
      name: "value-import-equals",
      prefix:
        "import require = require('provider-types'); require('next/router').useRouter = () => ({replace: () => {}});",
      expected: 1,
    },
  ])("preserves runtime binding: $name", ({ prefix, expected }) => {
    const result = runRule(noEffectEventHandler, prefix + "\n" + source, options);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  });
});
