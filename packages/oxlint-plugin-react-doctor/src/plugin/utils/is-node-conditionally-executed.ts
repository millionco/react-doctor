import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const isNodeConditionallyExecuted = (node: EsTreeNode, boundary: EsTreeNode): boolean => {
  let child = node;
  let parent = child.parent ?? null;
  while (parent && parent !== boundary) {
    if (isNodeOfType(parent, "IfStatement") && parent.test !== child) return true;
    if (
      isNodeOfType(parent, "ConditionalExpression") &&
      (parent.consequent === child || parent.alternate === child)
    ) {
      return true;
    }
    if (isNodeOfType(parent, "LogicalExpression") && parent.right === child) return true;
    if (isNodeOfType(parent, "AssignmentPattern") && parent.right === child) return true;
    if (isNodeOfType(parent, "SwitchCase")) return true;
    child = parent;
    parent = child.parent ?? null;
  }
  return false;
};
