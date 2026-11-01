import type { EsTreeNode } from "./es-tree-node.js";

export const getEnclosingClassMember = (
  node: EsTreeNode,
  classBody: EsTreeNode,
): EsTreeNode | null => {
  let current: EsTreeNode | null | undefined = node;
  while (current && current.parent !== classBody) current = current.parent;
  return current ?? null;
};
