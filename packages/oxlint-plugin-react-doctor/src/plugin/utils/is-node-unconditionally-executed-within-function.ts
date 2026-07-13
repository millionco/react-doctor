import type { EsTreeNode } from "./es-tree-node.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const isNodeUnconditionallyExecutedWithinFunction = (node: EsTreeNode): boolean => {
  const ownerFunction = findEnclosingFunction(node);
  let child = node;
  let parent = node.parent;
  while (parent && parent !== ownerFunction) {
    if (
      (isNodeOfType(parent, "IfStatement") &&
        (parent.consequent === child || parent.alternate === child)) ||
      (isNodeOfType(parent, "ConditionalExpression") &&
        (parent.consequent === child || parent.alternate === child)) ||
      (isNodeOfType(parent, "LogicalExpression") && parent.right === child) ||
      isNodeOfType(parent, "SwitchCase") ||
      (isNodeOfType(parent, "ForStatement") && parent.body === child) ||
      (isNodeOfType(parent, "ForInStatement") && parent.body === child) ||
      (isNodeOfType(parent, "ForOfStatement") && parent.body === child) ||
      (isNodeOfType(parent, "WhileStatement") && parent.body === child) ||
      (isNodeOfType(parent, "DoWhileStatement") && parent.body === child)
    ) {
      return false;
    }
    child = parent;
    parent = parent.parent;
  }
  return true;
};
