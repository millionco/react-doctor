import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";

export const findEnclosingFunction = (node: EsTreeNode): EsTreeNode | null => {
  let cursor: EsTreeNode | null = node.parent ?? null;
  while (cursor) {
    if (isFunctionLike(cursor)) return cursor;
    cursor = cursor.parent ?? null;
  }
  return null;
};
