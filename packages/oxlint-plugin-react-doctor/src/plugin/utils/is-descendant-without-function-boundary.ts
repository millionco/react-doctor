import type { EsTreeNode } from "./es-tree-node.js";
import { isFunctionLike } from "./is-function-like.js";

export const isDescendantWithoutFunctionBoundary = (
  descendant: EsTreeNode,
  ancestor: EsTreeNode,
): boolean => {
  let current: EsTreeNode | null | undefined = descendant;
  while (current && current !== ancestor) {
    if (current !== descendant && isFunctionLike(current)) return false;
    current = current.parent;
  }
  return current === ancestor;
};
