import { extname } from "node:path";
import ts from "typescript";
import { collectConfigPluginMapPackageNames } from "./collect-config-plugin-map-package-names.js";
import { getObjectLiteralElementName } from "./get-object-literal-element-name.js";
import { extractPackageName } from "./package-name.js";
import { stripCoffeeScriptComment } from "./strip-coffee-script-comment.js";

const STRUCTURED_TEXT_EXTENSIONS = new Set([".toml", ".yaml", ".yml"]);

const collectStructuredTextPackageReferences = (content: string): Set<string> => {
  const uncommentedContent = content.split("\n").map(stripCoffeeScriptComment).join("\n");
  const packageNames = new Set<string>();
  for (const tokenMatch of uncommentedContent.matchAll(
    /@?[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*/g,
  )) {
    const packageName = extractPackageName(tokenMatch[0]);
    if (packageName) packageNames.add(packageName);
  }
  return packageNames;
};

export const collectPackageConfigReferences = (filePath: string, content: string): Set<string> => {
  if (STRUCTURED_TEXT_EXTENSIONS.has(extname(filePath))) {
    return collectStructuredTextPackageReferences(content);
  }

  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const packageNames = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAssignment(node) && getObjectLiteralElementName(node) === "plugins") {
      for (const packageName of collectConfigPluginMapPackageNames(node.initializer)) {
        packageNames.add(packageName);
      }
    }
    if (ts.isStringLiteralLike(node)) {
      const packageName = extractPackageName(node.text);
      if (packageName) packageNames.add(packageName);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return packageNames;
};
