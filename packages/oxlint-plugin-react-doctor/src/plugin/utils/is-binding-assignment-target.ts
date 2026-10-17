import type { EsTreeNode } from "./es-tree-node.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const isBindingAssignmentTarget = (identifier: EsTreeNode): boolean => {
  if (!isNodeOfType(identifier, "Identifier")) return false;
  let currentNode = findTransparentExpressionRoot(identifier);
  while (currentNode.parent) {
    const parentNode = currentNode.parent;
    if (isNodeOfType(parentNode, "AssignmentExpression")) {
      return parentNode.left === currentNode;
    }
    if (isNodeOfType(parentNode, "UpdateExpression")) {
      return parentNode.argument === currentNode;
    }
    if (isNodeOfType(parentNode, "ForInStatement") || isNodeOfType(parentNode, "ForOfStatement")) {
      return parentNode.left === currentNode;
    }
    if (isNodeOfType(parentNode, "Property")) {
      if (parentNode.value !== currentNode || !isNodeOfType(parentNode.parent, "ObjectPattern")) {
        return false;
      }
    } else if (isNodeOfType(parentNode, "AssignmentPattern")) {
      if (parentNode.left !== currentNode) return false;
    } else if (isNodeOfType(parentNode, "RestElement")) {
      if (parentNode.argument !== currentNode) return false;
    } else if (
      !isNodeOfType(parentNode, "ArrayPattern") &&
      !isNodeOfType(parentNode, "ObjectPattern")
    ) {
      return false;
    }
    currentNode = findTransparentExpressionRoot(parentNode);
  }
  return false;
};
