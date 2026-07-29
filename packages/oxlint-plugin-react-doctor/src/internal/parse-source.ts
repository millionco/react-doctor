import * as path from "node:path";
import { parseSync } from "oxc-parser";
import type { Comment } from "oxc-parser";
import type { EsTreeNode } from "../plugin/utils/es-tree-node.js";

export interface ParseSourceOptions {
  readonly filename?: string;
  readonly forceJsx?: boolean;
}

export interface ParseSourceError {
  readonly message: string;
  readonly start?: number;
  readonly end?: number;
}

export interface ParseSourceResult {
  readonly program: EsTreeNode;
  readonly comments: ReadonlyArray<Comment>;
  readonly errors: ReadonlyArray<ParseSourceError>;
}

const FILENAME_TO_LANGUAGE: Record<string, "ts" | "tsx" | "js" | "jsx"> = {
  ".ts": "ts",
  ".tsx": "tsx",
  ".js": "js",
  ".jsx": "jsx",
  ".mjs": "js",
  ".cjs": "js",
  ".mts": "ts",
  ".cts": "ts",
};

const resolveLanguage = (filename: string): "ts" | "tsx" | "js" | "jsx" => {
  const extension = path.extname(filename).toLowerCase();
  return FILENAME_TO_LANGUAGE[extension] ?? "tsx";
};

export const parseSource = (
  sourceText: string,
  options: ParseSourceOptions = {},
): ParseSourceResult => {
  const filename = options.filename ?? "fixture.tsx";
  const language = options.forceJsx ? "tsx" : resolveLanguage(filename);
  const parseResult = parseSync(filename, sourceText, {
    astType: "ts",
    lang: language,
    preserveParens: false,
  });
  return {
    program: parseResult.program as unknown as EsTreeNode,
    comments: parseResult.comments,
    errors: parseResult.errors.map((parseError) => {
      const primaryLabel = parseError.labels[0];
      return {
        message: parseError.message,
        ...(primaryLabel ? { start: primaryLabel.start, end: primaryLabel.end } : {}),
      };
    }),
  };
};
