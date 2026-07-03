import * as fs from "node:fs";
import { parseExportSpecifiers } from "./parse-export-specifiers.js";
import { stripJsComments } from "./strip-js-comments.js";

const DEFAULT_EXPORT_DECLARATION_PATTERN = /^\s*export\s+default\b/m;
const NAMED_EXPORT_DECLARATION_PATTERN =
  /^\s*export\s+(?:declare\s+)?(?:(?:async\s+)?function|(?:abstract\s+)?class|const|let|var|enum|interface|type)\s+([\w$]+)/gm;
const LOCAL_EXPORT_SPECIFIER_DECLARATION_PATTERN =
  /^\s*export\s+(?:type\s+)?\{([\s\S]*?)\}(?:\s+from\s+["'][^"']+["'])?\s*;?\s*(?:(?:\/\/[^\n]*)?\s*)/gm;

const collectSourceTextExportNames = (sourceText: string): ReadonlySet<string> => {
  const strippedSource = stripJsComments(sourceText);
  const exportedNames = new Set<string>();
  if (DEFAULT_EXPORT_DECLARATION_PATTERN.test(strippedSource)) {
    exportedNames.add("default");
  }

  for (const match of strippedSource.matchAll(NAMED_EXPORT_DECLARATION_PATTERN)) {
    if (match[1]) exportedNames.add(match[1]);
  }

  for (const match of strippedSource.matchAll(LOCAL_EXPORT_SPECIFIER_DECLARATION_PATTERN)) {
    const specifiersText = match[1] ?? "";
    for (const specifier of parseExportSpecifiers(specifiersText, false)) {
      exportedNames.add(specifier.exportedName);
    }
  }

  return exportedNames;
};

interface ExportNamesCacheEntry {
  mtimeMs: number;
  size: number;
  exportedNames: ReadonlySet<string>;
}

// The same layout / barrel file is probed once per export name per page, so
// the read + comment-strip + export scan is cached per file, keyed by
// mtime/size for invalidation (mirrors `parse-source-file.ts`).
const exportNamesCache = new Map<string, ExportNamesCacheEntry>();

export const doesModuleExportName = (filePath: string, exportedName: string): boolean => {
  try {
    const fileStat = fs.statSync(filePath);
    const cached = exportNamesCache.get(filePath);
    if (cached && cached.mtimeMs === fileStat.mtimeMs && cached.size === fileStat.size) {
      return cached.exportedNames.has(exportedName);
    }
    const exportedNames = collectSourceTextExportNames(fs.readFileSync(filePath, "utf8"));
    exportNamesCache.set(filePath, {
      mtimeMs: fileStat.mtimeMs,
      size: fileStat.size,
      exportedNames,
    });
    return exportedNames.has(exportedName);
  } catch {
    return false;
  }
};
