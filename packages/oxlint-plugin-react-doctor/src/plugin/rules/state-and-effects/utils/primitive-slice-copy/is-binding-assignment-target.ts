import type { EsTreeNode } from "../../../../utils/es-tree-node.js";
import { findTransparentExpressionRoot } from "../../../../utils/find-transparent-expression-root.js";
import { isNodeOfType } from "../../../../utils/is-node-of-type.js";

export const isBindingAssignmentTarget = (identifier: EsTreeNode): boolean => {
  let target = findTransparentExpressionRoot(identifier);
  while (target.parent) {
    const parent = target.parent;
    if (
      isNodeOfType(parent, "Property") &&
      parent.value === target &&
      isNodeOfType(parent.parent, "ObjectPattern")
    ) {
      target = findTransparentExpressionRoot(parent.parent);
    } else if (
      (isNodeOfType(parent, "ArrayPattern") &&
        parent.elements.some((element) => element === target)) ||
      (isNodeOfType(parent, "ObjectPattern") &&
        parent.properties.some((property) => property === target)) ||
      (isNodeOfType(parent, "RestElement") && parent.argument === target) ||
      (isNodeOfType(parent, "AssignmentPattern") && parent.left === target)
    ) {
      target = findTransparentExpressionRoot(parent);
    } else {
      return (
        (isNodeOfType(parent, "AssignmentExpression") && parent.left === target) ||
        (isNodeOfType(parent, "UpdateExpression") && parent.argument === target) ||
        ((isNodeOfType(parent, "ForInStatement") || isNodeOfType(parent, "ForOfStatement")) &&
          parent.left === target)
      );
    }
  }
  return false;
};
