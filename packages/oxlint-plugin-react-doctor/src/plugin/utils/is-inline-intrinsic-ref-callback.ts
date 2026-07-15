import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getJsxAttributeName } from "./get-jsx-attribute-name.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isProvenIntrinsicJsxElement } from "./is-proven-intrinsic-jsx-element.js";
import type { EsTreeNode } from "./es-tree-node.js";

export const isInlineIntrinsicRefCallback = (
  functionNode: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
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
