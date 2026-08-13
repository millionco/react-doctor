import { parse, type DefaultTreeAdapterMap } from "parse5";
import { collectStaticModulePackageNames } from "./collect-static-module-package-names.js";

export const collectHtmlScriptPackageNames = (sourceText: string): Set<string> => {
  const packageNames = new Set<string>();

  const visitNode = (node: DefaultTreeAdapterMap["node"]): void => {
    if ("tagName" in node && node.tagName.toLowerCase() === "script") {
      for (const childNode of node.childNodes) {
        if (!("value" in childNode) || typeof childNode.value !== "string") continue;
        try {
          for (const packageName of collectStaticModulePackageNames(childNode.value)) {
            packageNames.add(packageName);
          }
        } catch {
          continue;
        }
      }
      return;
    }
    if ("childNodes" in node) {
      for (const childNode of node.childNodes) visitNode(childNode);
    }
    if ("content" in node) visitNode(node.content);
  };

  visitNode(parse(sourceText));
  return packageNames;
};
