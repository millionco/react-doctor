import * as fs from "node:fs";
import { parseExportSpecifiers } from "./parse-export-specifiers.js";
import { stripJsComments } from "./strip-js-comments.js";

const DEFAULT_EXPORT_DECLARATION_PATTERN = /^\s*export\s+default\b/m;
const NAMED_EXPORT_DECLARATION_PATTERN =
  /^\s*export\s+(?:declare\s+)?(?:(?:async\s+)?function|(?:abstract\s+)?class|const|let|var|enum|interface|type)\s+([\w$]+)/gm;
const LOCAL_EXPORT_SPECIFIER_DECLARATION_PATTERN =
  /^\s*export\s+(?:type\s+)?\{([\s\S]*?)\}(?:\s+from\s+["'][^"']+["'])?\s*;?\s*(?:(?:\/\/[^\n]*)?\s*)/gm;

const doesSourceTextExportName = (sourceText: string, exportedName: string): boolean => {
  const strippedSource = stripJsComments(sourceText);
  if (exportedName === "default" && DEFAULT_EXPORT_DECLARATION_PATTERN.test(strippedSource)) {
    return true;
  }

  for (const match of strippedSource.matchAll(NAMED_EXPORT_DECLARATION_PATTERN)) {
    if (match[1] === exportedName) return true;
  }

  for (const match of strippedSource.matchAll(LOCAL_EXPORT_SPECIFIER_DECLARATION_PATTERN)) {
    const specifiersText = match[1] ?? "";
    const exportedNames = parseExportSpecifiers(specifiersText, false).map(
      (specifier) => specifier.exportedName,
    );
    if (exportedNames.includes(exportedName)) return true;
  }

  return false;
};

export const doesModuleExportName = (filePath: string, exportedName: string): boolean => {
  try {
    return doesSourceTextExportName(fs.readFileSync(filePath, "utf8"), exportedName);
  } catch {
    return false;
  }
};
