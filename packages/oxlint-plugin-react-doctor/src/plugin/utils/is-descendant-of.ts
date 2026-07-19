import type { EsTreeNode } from "./es-tree-node.js";

export const isDescendantOf = (node: EsTreeNode, ancestor: EsTreeNode): boolean => {
  let currentNode: EsTreeNode | null | undefined = node;
  while (currentNode) {
    if (currentNode === ancestor) return true;
    currentNode = currentNode.parent;
  }
  return false;
};
