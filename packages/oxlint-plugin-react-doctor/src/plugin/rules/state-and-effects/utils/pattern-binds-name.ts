import { collectPatternNames } from "../../../utils/collect-pattern-names.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";

export const patternBindsName = (pattern: EsTreeNode | null | undefined, name: string): boolean => {
  const boundNames = new Set<string>();
  collectPatternNames(pattern ?? null, boundNames);
  return boundNames.has(name);
};
