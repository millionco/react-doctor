import { parseSync } from "oxc-parser";
import { extractMarkdownModuleStatements } from "./extract-markdown-module-statements.js";
import { extractPackageName } from "./package-name.js";

export const collectMarkdownModulePackageNames = (sourceText: string): Set<string> => {
  const moduleSource = extractMarkdownModuleStatements(sourceText);
  if (!moduleSource.trim()) return new Set();

  let parsedModule: ReturnType<typeof parseSync>;
  try {
    parsedModule = parseSync("content.mdx.jsx", moduleSource, { sourceType: "module" });
  } catch {
    return new Set();
  }
  if (parsedModule.errors.some((error) => error.severity === "Error")) return new Set();

  const packageNames = new Set<string>();
  const addSpecifier = (specifier: string): void => {
    const packageName = extractPackageName(specifier);
    if (packageName) packageNames.add(packageName);
  };
  for (const staticImport of parsedModule.module.staticImports) {
    addSpecifier(staticImport.moduleRequest.value);
  }
  for (const staticExport of parsedModule.module.staticExports) {
    for (const entry of staticExport.entries) {
      if (entry.moduleRequest) addSpecifier(entry.moduleRequest.value);
    }
  }
  return packageNames;
};
