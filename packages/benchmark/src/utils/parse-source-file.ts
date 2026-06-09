import * as fs from "node:fs";
import * as path from "node:path";
import { parseSync } from "oxc-parser";
import type { ParsedSourceFile, SourceComment } from "../types/index.js";

const EXTENSION_TO_LANG: Record<string, "ts" | "tsx" | "js" | "jsx"> = {
  ".ts": "ts",
  ".tsx": "tsx",
  ".mts": "ts",
  ".cts": "ts",
  ".js": "js",
  ".jsx": "jsx",
  ".mjs": "js",
  ".cjs": "js",
};

// Extensions the AST checks understand. Declaration files are excluded — they
// are types-only and carry no slop the agent can be charged for.
export const isParsableSourcePath = (filePath: string): boolean => {
  if (/\.d\.[mc]?ts$/.test(filePath)) return false;
  return path.extname(filePath).toLowerCase() in EXTENSION_TO_LANG;
};

// Parse source text for a given (repo-relative) path into a `ParsedSourceFile`,
// or `null` when the path is not a source extension or the parser hits a fatal
// error. Pure (no disk access) so checks can be unit-tested from strings.
export const parseSourceText = (filePath: string, sourceText: string): ParsedSourceFile | null => {
  if (!isParsableSourcePath(filePath)) return null;
  const lang = EXTENSION_TO_LANG[path.extname(filePath).toLowerCase()] ?? "tsx";
  try {
    const result = parseSync(filePath, sourceText, { astType: "ts", lang });
    if (result.errors.some((parseError) => parseError.severity === "Error")) return null;
    return {
      filePath,
      sourceText,
      program: result.program,
      comments: result.comments as unknown as SourceComment[],
    };
  } catch {
    return null;
  }
};

// Read and parse one repo-relative source file, or `null` when it is missing,
// unparsable, or not a source extension.
export const parseSourceFile = (
  rootDirectory: string,
  filePath: string,
): ParsedSourceFile | null => {
  if (!isParsableSourcePath(filePath)) return null;
  try {
    const sourceText = fs.readFileSync(path.join(rootDirectory, filePath), "utf8");
    return parseSourceText(filePath, sourceText);
  } catch {
    return null;
  }
};
