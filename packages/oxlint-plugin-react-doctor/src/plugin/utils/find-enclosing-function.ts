import type { EsTreeNode } from "./es-tree-node.js";
import { isFunctionLike } from "./is-function-like.js";

// The nearest ancestor function (arrow / expression / declaration) of `node`,
// or null when it is not nested in one. Walks strict ancestors from node.parent.
export const findEnclosingFunction = (node: EsTreeNode): EsTreeNode | null => {
  let cursor: EsTreeNode | null | undefined = node.parent;
  while (cursor) {
    if (isFunctionLike(cursor)) return cursor;
    cursor = cursor.parent ?? null;
  }
  return null;
};
