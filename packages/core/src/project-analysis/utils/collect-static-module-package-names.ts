import { collectStaticModuleSpecifiers } from "./collect-static-module-specifiers.js";
import { extractPackageName } from "./package-name.js";

export const collectStaticModulePackageNames = (sourceText: string): Set<string> => {
  const packageNames = new Set<string>();
  for (const specifier of collectStaticModuleSpecifiers(sourceText, {
    filePath: "package-reference.tsx",
  })) {
    const packageName = extractPackageName(specifier);
    if (packageName) packageNames.add(packageName);
  }
  return packageNames;
};
