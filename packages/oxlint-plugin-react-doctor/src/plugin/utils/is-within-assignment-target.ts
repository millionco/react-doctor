import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const isWithinAssignmentTarget = (identifier: EsTreeNode): boolean => {
  let currentNode = identifier;
  let parentNode = currentNode.parent;
  while (parentNode) {
    if (isNodeOfType(parentNode, "AssignmentExpression")) {
      return parentNode.left === currentNode;
    }
    if (
      isNodeOfType(parentNode, "UpdateExpression") ||
      (isNodeOfType(parentNode, "UnaryExpression") && parentNode.operator === "delete")
    ) {
      return parentNode.argument === currentNode;
    }
    if (isNodeOfType(parentNode, "ForInStatement") || isNodeOfType(parentNode, "ForOfStatement")) {
      return parentNode.left === currentNode;
    }
    currentNode = parentNode;
    parentNode = currentNode.parent;
  }
  return false;
};
