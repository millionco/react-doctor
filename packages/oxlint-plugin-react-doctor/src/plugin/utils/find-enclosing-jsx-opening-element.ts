import { isNodeOfType } from "./is-node-of-type.js";
import type { EsTreeNode } from "./es-tree-node.js";

export const findEnclosingJsxOpeningElement = (node: EsTreeNode): EsTreeNode | null => {
  let cursor: EsTreeNode | null | undefined = node.parent;
  while (cursor) {
    if (isNodeOfType(cursor, "JSXElement")) return cursor.openingElement;
    if (isNodeOfType(cursor, "JSXFragment")) return null;
    cursor = cursor.parent ?? null;
  }
  return null;
};
