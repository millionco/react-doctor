import * as fs from "node:fs";
import { collectStaticModuleSpecifiers } from "../../../project-analysis/utils/collect-static-module-specifiers.js";
import { walkSourceTreeFiles } from "../../../utils/walk-source-tree-files.js";

const JAVASCRIPT_MODULE_FILE_PATTERN = /\.[cm]?[jt]sx?$/;

export const hasStaticModuleSubpath = (rootDirectory: string, packageName: string): boolean => {
  const packageSubpathPrefix = `${packageName}/`;

  for (const { absolutePath, name } of walkSourceTreeFiles(rootDirectory)) {
    if (!JAVASCRIPT_MODULE_FILE_PATTERN.test(name)) continue;

    let sourceText: string;
    try {
      sourceText = fs.readFileSync(absolutePath, "utf-8");
    } catch {
      continue;
    }
    if (!sourceText.includes(packageSubpathPrefix)) continue;

    let moduleSpecifiers: Set<string>;
    try {
      moduleSpecifiers = collectStaticModuleSpecifiers(sourceText, { filePath: absolutePath });
    } catch {
      continue;
    }
    for (const moduleSpecifier of moduleSpecifiers) {
      if (moduleSpecifier.startsWith(packageSubpathPrefix)) return true;
    }
  }

  return false;
};
