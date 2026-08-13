import ts from "typescript";
import { collectStaticModulePackageNames } from "./collect-static-module-package-names.js";
import { extractPackageName } from "./package-name.js";

export const collectPackageImportNames = (content: string): Set<string> => {
  const packageNames = collectStaticModulePackageNames(content);
  const sourceFile = ts.createSourceFile(
    "package-reference.ts",
    content,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  for (const typeReferenceDirective of sourceFile.typeReferenceDirectives) {
    const packageName = extractPackageName(typeReferenceDirective.fileName);
    if (packageName) packageNames.add(packageName);
  }
  return packageNames;
};

export const matchesPackageImportReference = (content: string, packageName: string): boolean =>
  collectPackageImportNames(content).has(packageName);
