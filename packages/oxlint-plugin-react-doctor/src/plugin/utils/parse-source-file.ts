import * as fs from "node:fs";
import * as path from "node:path";
import { parseSync } from "oxc-parser";
import { CROSS_FILE_PARSE_MAX_BYTES } from "../constants/thresholds.js";
import { attachParentReferences } from "./attach-parent-references.js";
import { recordContentProbe } from "./cross-file-probe-recorder.js";
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

// Exported so the cross-file dependency collectors parse a file with the
// SAME language selection as the rules' own cross-file parses.
export const resolveLang = (filename: string): "ts" | "tsx" | "js" | "jsx" => {
  const extension = path.extname(filename).toLowerCase();
  return FILENAME_TO_LANG[extension] ?? "tsx";
};

interface CacheEntry {
  readonly mtimeMs: number;
  readonly size: number;
  readonly program: EsTreeNode | null;
}

export interface ParseSourceTextInput {
  readonly filename: string;
  readonly sourceText: string;
  readonly shouldAttachParentReferences?: boolean;
}

export const parseSourceText = ({
  filename,
  sourceText,
  shouldAttachParentReferences = true,
}: ParseSourceTextInput): EsTreeNode | null => {
  try {
    const result = parseSync(filename, sourceText, {
      astType: "ts",
      lang: resolveLang(filename),
    });
    const hasFatalError = result.errors.some((parseError) => parseError.severity === "Error");
    if (hasFatalError) return null;
    const parsedProgram = result.program as unknown as EsTreeNode;
    if (shouldAttachParentReferences) attachParentReferences(parsedProgram);
    return parsedProgram;
  } catch {
    return null;
  }
};

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
  // Declaration files are constant-null regardless of the filesystem (absent,
  // present, any size — every branch below lands on `null`), so they are not
  // a dependency and record no probe. Everything else records its content
  // probe BEFORE the cache lookup — the parse is a pure function of this one
  // file's content (see cross-file-probe-recorder.ts).
  const isDeclarationFile =
    absoluteFilePath.endsWith(".d.ts") ||
    absoluteFilePath.endsWith(".d.mts") ||
    absoluteFilePath.endsWith(".d.cts");
  if (!isDeclarationFile) recordContentProbe(absoluteFilePath);

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

  const parsedProgram = parseSourceText({
    filename: absoluteFilePath,
    sourceText,
  });

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
