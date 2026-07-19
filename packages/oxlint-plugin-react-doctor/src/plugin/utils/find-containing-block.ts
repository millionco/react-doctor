import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const findContainingBlock = (
  node: EsTreeNode,
): EsTreeNodeOfType<"BlockStatement"> | null => {
  let current: EsTreeNode | null | undefined = node.parent;
  while (current) {
    if (isNodeOfType(current, "BlockStatement")) return current;
    current = current.parent;
  }
  return null;
};
