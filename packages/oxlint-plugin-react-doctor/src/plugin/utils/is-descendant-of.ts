import type { EsTreeNode } from "./es-tree-node.js";

export const isDescendantOf = (node: EsTreeNode, ancestor: EsTreeNode): boolean => {
  let current: EsTreeNode | null = node;
  while (current) {
    if (current === ancestor) return true;
    current = current.parent ?? null;
  }
  return false;
};
