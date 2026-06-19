import * as path from "node:path";
import { parseSync } from "oxc-parser";
import type { EsTreeNode } from "../src/ast/es-tree-node.js";

interface ParseFixtureResult {
  program: EsTreeNode;
  errors: ReadonlyArray<{ message: string }>;
}

const FILENAME_TO_LANG: Record<string, "ts" | "tsx" | "js" | "jsx"> = {
  ".ts": "ts",
  ".tsx": "tsx",
  ".js": "js",
  ".jsx": "jsx",
  ".mjs": "js",
  ".cjs": "js",
  ".mts": "ts",
  ".cts": "ts",
};

const resolveLang = (filename: string): "ts" | "tsx" | "js" | "jsx" => {
  const extension = path.extname(filename).toLowerCase();
  return FILENAME_TO_LANG[extension] ?? "tsx";
};

// Parses a code fixture using oxc-parser (the same engine oxlint uses at
// runtime) with `astType: "ts"` so the returned AST is TSESTree-shaped —
// matching the type universe `EsTreeNode` describes. The default filename
// ends in `.tsx` so JSX always parses.
export const parseFixture = (code: string, filename = "fixture.tsx"): ParseFixtureResult => {
  const result = parseSync(filename, code, { astType: "ts", lang: resolveLang(filename) });
  return {
    program: result.program as unknown as EsTreeNode,
    errors: result.errors.map((parseError) => ({ message: parseError.message })),
  };
};
