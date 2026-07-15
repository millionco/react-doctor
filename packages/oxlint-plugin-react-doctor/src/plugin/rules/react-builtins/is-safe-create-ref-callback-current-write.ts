import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { getJsxAttributeName } from "../../utils/get-jsx-attribute-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isProvenIntrinsicJsxElement } from "../../utils/is-proven-intrinsic-jsx-element.js";
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

const isInlineIntrinsicRefCallback = (functionNode: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const functionExpression = findTransparentExpressionRoot(functionNode);
  if (
    !isFunctionLike(functionExpression) ||
    functionExpression.async ||
    functionExpression.generator
  ) {
    return false;
  }
  const container = functionExpression.parent;
  if (!container || !isNodeOfType(container, "JSXExpressionContainer")) return false;
  const attribute = container.parent;
  if (
    !attribute ||
    !isNodeOfType(attribute, "JSXAttribute") ||
    getJsxAttributeName(attribute.name) !== "ref"
  ) {
    return false;
  }
  const openingElement = attribute.parent;
  return Boolean(
    openingElement &&
    isNodeOfType(openingElement, "JSXOpeningElement") &&
    isProvenIntrinsicJsxElement(openingElement, scopes),
  );
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
