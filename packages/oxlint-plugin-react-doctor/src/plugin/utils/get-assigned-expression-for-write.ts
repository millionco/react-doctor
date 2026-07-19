import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

export const getAssignedExpressionForWrite = (writeIdentifier: EsTreeNode): EsTreeNode | null => {
  let assignmentTarget = writeIdentifier;
  let parent = assignmentTarget.parent;
  while (parent && stripParenExpression(parent) === writeIdentifier) {
    assignmentTarget = parent;
    parent = assignmentTarget.parent;
  }
  return parent &&
    isNodeOfType(parent, "AssignmentExpression") &&
    parent.operator === "=" &&
    parent.left === assignmentTarget
    ? parent.right
    : null;
};
