const THREE_MODULE_IMPORT_PATTERN =
  /\b(?:from\s*|import\s*(?:\(\s*)?|require\s*\(\s*)["']three(?:\/[^"']*)?["']/;

export const containsThreeModuleImport = (sourceText: string): boolean =>
  THREE_MODULE_IMPORT_PATTERN.test(sourceText);
