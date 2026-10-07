import { collectStaticModulePackageNames } from "./collect-static-module-package-names.js";
import { collectTwoslashPackageNames } from "./collect-twoslash-package-names.js";
import { extractMarkdownModuleStatements } from "./extract-markdown-module-statements.js";

export const collectMarkdownModulePackageNames = (sourceText: string): Set<string> => {
  const packageNames = collectTwoslashPackageNames(sourceText);
  const moduleSource = extractMarkdownModuleStatements(sourceText);
  if (!moduleSource.trim()) return packageNames;
  try {
    for (const packageName of collectStaticModulePackageNames(moduleSource)) {
      packageNames.add(packageName);
    }
  } catch {
    return packageNames;
  }
  return packageNames;
};
