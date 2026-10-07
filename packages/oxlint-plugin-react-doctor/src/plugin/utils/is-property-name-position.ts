import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const isPropertyNamePosition = (identifier: EsTreeNode): boolean => {
  const parent = identifier.parent;
  if (!parent) return false;
  if (isNodeOfType(parent, "MemberExpression")) {
    return parent.property === identifier && !parent.computed;
  }
  return isNodeOfType(parent, "Property") && parent.key === identifier && !parent.computed;
};
