import { fromMarkdown } from "mdast-util-from-markdown";
import { collectStaticModulePackageNames } from "./collect-static-module-package-names.js";

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
    } catch {
      continue;
    }
  }
  return packageNames;
};
