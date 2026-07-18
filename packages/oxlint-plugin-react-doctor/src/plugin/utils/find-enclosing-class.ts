import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const findEnclosingClass = (
  node: EsTreeNode,
): EsTreeNodeOfType<"ClassDeclaration" | "ClassExpression"> | null => {
  let ancestor: EsTreeNode | null | undefined = node.parent;
  while (ancestor) {
    if (isNodeOfType(ancestor, "ClassDeclaration") || isNodeOfType(ancestor, "ClassExpression")) {
      return ancestor;
    }
    ancestor = ancestor.parent ?? null;
  }
  return null;
};
