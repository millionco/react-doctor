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

describe("runtime imported provider reference attribution", () => {
  it.each([
    { name: "baseline", prefix: "", expected: 0 },
    {
      name: "useRouter-direct",
      prefix: "const rewriteProvider=()=>{ mutate(useRouter);}; rewriteProvider();",
      expected: 1,
    },
    {
      name: "useRouter-interface",
      prefix:
        "const rewriteProvider=()=>{interface useRouter {} mutate(useRouter);}; rewriteProvider();",
      expected: 1,
    },
    {
      name: "useRouter-typealias",
      prefix:
        "const rewriteProvider=()=>{type useRouter=unknown; mutate(useRouter);}; rewriteProvider();",
      expected: 1,
    },
    {
      name: "useEffect-direct",
      prefix: "const rewriteProvider=()=>{ mutate(useEffect);}; rewriteProvider();",
      expected: 1,
    },
    {
      name: "useEffect-interface",
      prefix:
        "const rewriteProvider=()=>{interface useEffect {} mutate(useEffect);}; rewriteProvider();",
      expected: 1,
    },
    {
      name: "useEffect-typealias",
      prefix:
        "const rewriteProvider=()=>{type useEffect=unknown; mutate(useEffect);}; rewriteProvider();",
      expected: 1,
    },
  ])("preserves runtime exposure: $name", ({ prefix, expected }) => {
    const result = runRule(noEffectEventHandler, prefix + "\n" + source, options);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  });
});
