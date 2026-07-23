import * as path from "node:path";
import { parseSync } from "oxc-parser";
import type { EsTreeNode } from "../plugin/utils/es-tree-node.js";

interface ParseFixtureOptions {
  filename?: string;
  // HACK: The filename normally drives `lang` derivation, but tests for
  // rules like jsx-filename-extension want to parse JSX in a file named
  // `Foo.js` to reproduce the diagnostic. Setting `forceJsx: true`
  // overrides the lang derivation to always parse with TSX.
  forceJsx?: boolean;
}

export interface ParseFixtureResult {
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
// matching the type universe our `@typescript-eslint/types`-typed rule
// visitors operate on — and `preserveParens: false` so `(a ? b : c)` never
// carries the ParenthesizedExpression wrapper production oxlint never
// emits. The default filename ends in `.tsx` so JSX always parses; pass an
// explicit filename to test `.ts` / `.js` paths.
export const parseFixture = (
  code: string,
  options: ParseFixtureOptions = {},
): ParseFixtureResult => {
  const filename = options.filename ?? "fixture.tsx";
  const lang = options.forceJsx ? "tsx" : resolveLang(filename);
  const result = parseSync(filename, code, { astType: "ts", lang, preserveParens: false });
  return {
    program: result.program as unknown as EsTreeNode,
    errors: result.errors.map((parseError) => ({ message: parseError.message })),
  };
};
