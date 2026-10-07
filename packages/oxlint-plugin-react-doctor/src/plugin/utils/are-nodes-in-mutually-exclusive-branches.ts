import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const areNodesInMutuallyExclusiveBranches = (
  firstNode: EsTreeNode,
  secondNode: EsTreeNode,
): boolean => {
  const firstBranchByAncestor = new Map<EsTreeNode, EsTreeNode>();
  let current: EsTreeNode | null | undefined = firstNode;
  while (current?.parent) {
    const parent: EsTreeNode = current.parent;
    if (
      (isNodeOfType(parent, "IfStatement") || isNodeOfType(parent, "ConditionalExpression")) &&
      (parent.consequent === current || parent.alternate === current)
    ) {
      firstBranchByAncestor.set(parent, current);
    }
    current = parent;
  }

  current = secondNode;
  while (current?.parent) {
    const parent: EsTreeNode = current.parent;
    if (
      (isNodeOfType(parent, "IfStatement") || isNodeOfType(parent, "ConditionalExpression")) &&
      (parent.consequent === current || parent.alternate === current)
    ) {
      const firstBranch = firstBranchByAncestor.get(parent);
      if (firstBranch !== undefined && firstBranch !== current) return true;
    }
    current = parent;
  }
  return false;
};
