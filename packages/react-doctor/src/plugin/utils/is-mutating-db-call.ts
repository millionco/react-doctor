import { MUTATION_METHOD_NAMES } from "../constants/library.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const isMutatingDbCall = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "CallExpression") || !isNodeOfType(node.callee, "MemberExpression"))
    return false;
  const { property } = node.callee;
  return isNodeOfType(property, "Identifier") && MUTATION_METHOD_NAMES.has(property.name);
};
