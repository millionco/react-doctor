import * as fs from "node:fs";
import * as path from "node:path";
import { parseSync } from "oxc-parser";
import { CROSS_FILE_PARSE_MAX_BYTES } from "../constants/thresholds.js";
import { attachParentReferences } from "./attach-parent-references.js";
import type { EsTreeNode } from "./es-tree-node.js";

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

interface CacheEntry {
  readonly mtimeMs: number;
  readonly size: number;
  readonly program: EsTreeNode | null;
}

// Module-level cache of parsed Programs keyed by absolute file path.
// Each entry stores the file's mtime + byte size at parse time so a
// changed file invalidates the cache automatically. Storing `null`
// for known-broken files prevents re-parsing the same .d.ts /
// generated / unparseable file on every rule invocation.
const parseCache = new Map<string, CacheEntry>();

// Parses a file at `absoluteFilePath` and returns the program AST
// with parent references attached, or null when the file is missing
// / too large / .d.ts-only / fails to parse.
//
// Cached by (absolute path, mtime, size). Re-parsing only happens
// when one of those changes. Cache lives for the lifetime of the
// Node process, which matches the way oxlint runs a single batch
// of files per process.
export const parseSourceFile = (absoluteFilePath: string): EsTreeNode | null => {
  let fileStat: fs.Stats;
  try {
    fileStat = fs.statSync(absoluteFilePath);
  } catch {
    return null;
  }
  if (!fileStat.isFile()) return null;
  if (fileStat.size > CROSS_FILE_PARSE_MAX_BYTES) return null;

  const cached = parseCache.get(absoluteFilePath);
  if (cached && cached.mtimeMs === fileStat.mtimeMs && cached.size === fileStat.size) {
    return cached.program;
  }

  // TypeScript declaration files are types-only — they have no
  // runtime function bodies to analyse. Cache as miss so we don't
  // retry parsing them on every cross-file lookup. All three
  // declaration-file extensions are handled (`.d.ts`, `.d.mts`,
  // `.d.cts`) so the ESM/CJS variants don't slip through.
  if (
    absoluteFilePath.endsWith(".d.ts") ||
    absoluteFilePath.endsWith(".d.mts") ||
    absoluteFilePath.endsWith(".d.cts")
  ) {
    parseCache.set(absoluteFilePath, {
      mtimeMs: fileStat.mtimeMs,
      size: fileStat.size,
      program: null,
    });
    return null;
  }

  let sourceText: string;
  try {
    sourceText = fs.readFileSync(absoluteFilePath, "utf8");
  } catch {
    parseCache.set(absoluteFilePath, {
      mtimeMs: fileStat.mtimeMs,
      size: fileStat.size,
      program: null,
    });
    return null;
  }

  let parsedProgram: EsTreeNode | null = null;
  try {
    const result = parseSync(absoluteFilePath, sourceText, {
      astType: "ts",
      lang: resolveLang(absoluteFilePath),
    });
    // Treat fatal parse errors as a parse failure (returns null).
    // Recoverable warnings still produce a usable AST.
    const hasFatalError = result.errors.some((parseError) => parseError.severity === "Error");
    if (!hasFatalError) {
      parsedProgram = result.program as unknown as EsTreeNode;
      attachParentReferences(parsedProgram);
    }
  } catch {
    parsedProgram = null;
  }

  parseCache.set(absoluteFilePath, {
    mtimeMs: fileStat.mtimeMs,
    size: fileStat.size,
    program: parsedProgram,
  });
  return parsedProgram;
};

// Exposed for tests. Production callers don't need to clear the
// cache — the mtime/size key handles invalidation.
export const __clearParseSourceFileCacheForTests = (): void => {
  parseCache.clear();
};
