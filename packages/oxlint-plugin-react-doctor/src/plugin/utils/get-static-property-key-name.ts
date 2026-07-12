import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";

export interface StaticPropertyKeyOptions {
  allowComputedString?: boolean;
  stringifyNonStringLiterals?: boolean;
}

export const getStaticPropertyKeyName = (
  node: EsTreeNode,
  options: StaticPropertyKeyOptions = {},
): string | null => {
  if (!isNodeOfType(node, "Property") && !isNodeOfType(node, "MethodDefinition")) return null;
  if (node.computed) {
    if (
      options.allowComputedString &&
      isNodeOfType(node.key, "Literal") &&
      typeof node.key.value === "string"
    ) {
      return node.key.value;
    }
    return null;
  }
  if (isNodeOfType(node.key, "Identifier")) return node.key.name;
  if (isNodeOfType(node.key, "Literal")) {
    if (typeof node.key.value === "string") return node.key.value;
    if (options.stringifyNonStringLiterals) return String(node.key.value);
  }
  return null;
};
