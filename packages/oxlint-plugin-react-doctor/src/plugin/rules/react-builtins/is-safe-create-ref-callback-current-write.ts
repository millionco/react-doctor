import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { isInlineIntrinsicRefCallback } from "../../utils/is-inline-intrinsic-ref-callback.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";

const pathStartsWith = (
  propertyPath: ReadonlyArray<string>,
  prefix: ReadonlyArray<string>,
): boolean => prefix.every((propertyName, index) => propertyPath[index] === propertyName);

const collectMemberExpression = (identifier: EsTreeNode): EsTreeNode | null => {
  let expression = findTransparentExpressionRoot(identifier);
  while (
    expression.parent &&
    isNodeOfType(expression.parent, "MemberExpression") &&
    expression.parent.object === expression
  ) {
    if (!getStaticPropertyName(expression.parent)) return null;
    expression = findTransparentExpressionRoot(expression.parent);
  }
  return expression;
};

export const isSafeCreateRefCallbackCurrentWrite = (
  referenceNode: EsTreeNode,
  accessedPropertyPath: ReadonlyArray<string>,
  targetPropertyPath: ReadonlyArray<string>,
  scopes: ScopeAnalysis,
): boolean => {
  if (
    accessedPropertyPath.length !== targetPropertyPath.length + 1 ||
    !pathStartsWith(accessedPropertyPath, targetPropertyPath) ||
    accessedPropertyPath[targetPropertyPath.length] !== "current"
  ) {
    return false;
  }
  const memberExpression = collectMemberExpression(referenceNode);
  const assignment = memberExpression?.parent;
  if (
    !memberExpression ||
    !assignment ||
    !isNodeOfType(assignment, "AssignmentExpression") ||
    assignment.operator !== "=" ||
    assignment.left !== memberExpression
  ) {
    return false;
  }
  const enclosingFunction = findEnclosingFunction(referenceNode);
  if (!enclosingFunction) return false;
  if (isInlineIntrinsicRefCallback(enclosingFunction, scopes)) return true;
  if (
    !isFunctionLike(enclosingFunction) ||
    enclosingFunction.async ||
    enclosingFunction.generator
  ) {
    return false;
  }
  const callbackFunction = findEnclosingFunction(enclosingFunction);
  if (!callbackFunction || !isInlineIntrinsicRefCallback(callbackFunction, scopes)) return false;
  const cleanupFunction = findTransparentExpressionRoot(enclosingFunction);
  const cleanupContainer = cleanupFunction.parent;
  return Boolean(
    (isNodeOfType(cleanupContainer, "ReturnStatement") &&
      cleanupContainer.argument === cleanupFunction &&
      findEnclosingFunction(cleanupContainer) === callbackFunction) ||
    (isNodeOfType(callbackFunction, "ArrowFunctionExpression") &&
      callbackFunction.body === cleanupFunction),
  );
};
