import { fromMarkdown } from "mdast-util-from-markdown";
import ts from "typescript";
import { collectStaticModulePackageNames } from "./collect-static-module-package-names.js";
import { extractPackageName } from "./package-name.js";

const collectTwoslashSources = (value: unknown, sources: string[]): void => {
  if (!value || typeof value !== "object") return;
  if (
    "type" in value &&
    value.type === "code" &&
    "value" in value &&
    typeof value.value === "string" &&
    "meta" in value &&
    typeof value.meta === "string" &&
    value.meta.split(/\s+/).includes("twoslash")
  ) {
    sources.push(value.value);
  }
  if (!("children" in value) || !Array.isArray(value.children)) return;
  for (const child of value.children) collectTwoslashSources(child, sources);
};

export const collectTwoslashPackageNames = (sourceText: string): Set<string> => {
  const sources: string[] = [];
  collectTwoslashSources(fromMarkdown(sourceText), sources);
  const packageNames = new Set<string>();
  for (const source of sources) {
    try {
      for (const packageName of collectStaticModulePackageNames(source)) {
        packageNames.add(packageName);
      }
      const sourceFile = ts.createSourceFile(
        "twoslash-source.js",
        source,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.JS,
      );
      const visitNode = (node: ts.Node): void => {
        for (const tag of ts.getJSDocTags(node)) {
          if (!ts.isJSDocImportTag(tag) || !ts.isStringLiteralLike(tag.moduleSpecifier)) continue;
          const packageName = extractPackageName(tag.moduleSpecifier.text);
          if (packageName) packageNames.add(packageName);
        }
        ts.forEachChild(node, visitNode);
      };
      visitNode(sourceFile);
    } catch {
      continue;
    }
  }
  return packageNames;
};
