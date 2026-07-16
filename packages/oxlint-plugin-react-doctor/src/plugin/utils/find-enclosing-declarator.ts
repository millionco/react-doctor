import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";

// The VariableDeclarator that declares `bindingIdentifier`, or null when
// the binding is a function parameter (a parameter typed as an object/array
// may have a meaningful `toString()`, so callers skip it).
export const findEnclosingDeclarator = (
  bindingIdentifier: EsTreeNode,
): EsTreeNodeOfType<"VariableDeclarator"> | null => {
  let cursor: EsTreeNode | null | undefined = bindingIdentifier.parent;
  while (cursor) {
    if (isNodeOfType(cursor, "VariableDeclarator")) return cursor;
    if (isFunctionLike(cursor)) return null;
    cursor = cursor.parent ?? null;
  }
  return null;
};
