import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const findEnclosingDeclarator = (
  bindingIdentifier: EsTreeNode,
): EsTreeNodeOfType<"VariableDeclarator"> | null => {
  let ancestor: EsTreeNode | null | undefined = bindingIdentifier.parent;
  while (ancestor) {
    if (isNodeOfType(ancestor, "VariableDeclarator")) return ancestor;
    if (isFunctionLike(ancestor)) return null;
    ancestor = ancestor.parent ?? null;
  }
  return null;
};
