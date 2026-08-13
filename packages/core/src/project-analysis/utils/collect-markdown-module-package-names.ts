import { collectStaticModulePackageNames } from "./collect-static-module-package-names.js";
import { extractMarkdownModuleStatements } from "./extract-markdown-module-statements.js";

export const collectMarkdownModulePackageNames = (sourceText: string): Set<string> => {
  const moduleSource = extractMarkdownModuleStatements(sourceText);
  if (!moduleSource.trim()) return new Set();
  try {
    return collectStaticModulePackageNames(moduleSource);
  } catch {
    return new Set();
  }
};
