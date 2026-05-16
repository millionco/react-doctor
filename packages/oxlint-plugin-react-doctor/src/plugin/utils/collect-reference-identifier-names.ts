import type { EsTreeNode } from "./es-tree-node.js";
import { isAstNode } from "./is-ast-node.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const collectReferenceIdentifierNames = (
  node: EsTreeNode | null | undefined,
  into: Set<string>,
): void => {
  if (!node) return;
  if (isNodeOfType(node, "Identifier")) {
    into.add(node.name);
    return;
  }
  if (isNodeOfType(node, "MemberExpression")) {
    collectReferenceIdentifierNames(node.object, into);
    if (node.computed) collectReferenceIdentifierNames(node.property, into);
    return;
  }
  if (isNodeOfType(node, "Property")) {
    if (node.computed) collectReferenceIdentifierNames(node.key, into);
    collectReferenceIdentifierNames(node.value, into);
    return;
  }
  for (const [key, child] of Object.entries(node)) {
    if (key === "parent") continue;
    if (Array.isArray(child)) {
      for (const item of child) {
        if (isAstNode(item)) collectReferenceIdentifierNames(item, into);
      }
    } else if (isAstNode(child)) {
      collectReferenceIdentifierNames(child, into);
    }
  }
};
