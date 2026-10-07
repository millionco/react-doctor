import type { EsTreeNode } from "./es-tree-node.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const areNodesOnExclusiveConditionalBranches = (
  firstNode: EsTreeNode,
  secondNode: EsTreeNode,
  boundary: EsTreeNode,
): boolean => {
  const firstBranches = new Map<EsTreeNode, "consequent" | "alternate">();
  let firstChild = firstNode;
  let firstAncestor: EsTreeNode | null | undefined = firstNode.parent;
  while (firstAncestor) {
    if (isFunctionLike(firstAncestor)) break;
    if (
      isNodeOfType(firstAncestor, "ConditionalExpression") ||
      isNodeOfType(firstAncestor, "IfStatement")
    ) {
      if (firstAncestor.consequent === firstChild) firstBranches.set(firstAncestor, "consequent");
      if (firstAncestor.alternate === firstChild) firstBranches.set(firstAncestor, "alternate");
    }
    if (firstAncestor === boundary) break;
    firstChild = firstAncestor;
    firstAncestor = firstAncestor.parent ?? null;
  }

  let secondChild = secondNode;
  let secondAncestor: EsTreeNode | null | undefined = secondNode.parent;
  while (secondAncestor) {
    if (isFunctionLike(secondAncestor)) break;
    if (
      isNodeOfType(secondAncestor, "ConditionalExpression") ||
      isNodeOfType(secondAncestor, "IfStatement")
    ) {
      const firstBranch = firstBranches.get(secondAncestor);
      if (firstBranch === "consequent" && secondAncestor.alternate === secondChild) return true;
      if (firstBranch === "alternate" && secondAncestor.consequent === secondChild) return true;
    }
    if (secondAncestor === boundary) break;
    secondChild = secondAncestor;
    secondAncestor = secondAncestor.parent ?? null;
  }
  return false;
};
