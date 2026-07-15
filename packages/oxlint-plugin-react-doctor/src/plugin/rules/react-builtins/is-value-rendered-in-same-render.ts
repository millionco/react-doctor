import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { isJsxFragmentElement } from "../../utils/is-jsx-fragment-element.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isProvenIntrinsicJsxElement } from "../../utils/is-proven-intrinsic-jsx-element.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";

interface ValueRenderedInSameRenderOptions {
  readonly doesCustomElementRenderChildren?: (openingElement: EsTreeNode) => boolean;
}

const isValueRenderedFromOwner = (
  expressionNode: EsTreeNode,
  renderOwner: EsTreeNode | null,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number>,
  options: ValueRenderedInSameRenderOptions,
): boolean => {
  const expression = findTransparentExpressionRoot(expressionNode);
  const parent = expression.parent;
  if (!parent) return false;
  if (isNodeOfType(parent, "ReturnStatement") && parent.argument === expression) {
    return findEnclosingFunction(parent) === renderOwner;
  }
  if (isNodeOfType(parent, "ArrowFunctionExpression") && parent.body === expression) {
    return parent === renderOwner;
  }
  if (
    isNodeOfType(parent, "JSXFragment") &&
    parent.children.some((child) => child === expression)
  ) {
    return isValueRenderedFromOwner(parent, renderOwner, scopes, visitedSymbolIds, options);
  }
  if (
    isNodeOfType(parent, "JSXElement") &&
    parent.children.some((child) => child === expression) &&
    (isProvenIntrinsicJsxElement(parent.openingElement, scopes) ||
      isJsxFragmentElement(parent.openingElement, scopes) ||
      options.doesCustomElementRenderChildren?.(parent.openingElement))
  ) {
    return isValueRenderedFromOwner(parent, renderOwner, scopes, visitedSymbolIds, options);
  }
  if (
    isNodeOfType(parent, "JSXExpressionContainer") &&
    parent.expression === expression &&
    parent.parent &&
    (isNodeOfType(parent.parent, "JSXFragment") ||
      (isNodeOfType(parent.parent, "JSXElement") &&
        (isProvenIntrinsicJsxElement(parent.parent.openingElement, scopes) ||
          isJsxFragmentElement(parent.parent.openingElement, scopes) ||
          options.doesCustomElementRenderChildren?.(parent.parent.openingElement))))
  ) {
    return isValueRenderedFromOwner(parent.parent, renderOwner, scopes, visitedSymbolIds, options);
  }
  if (
    (isNodeOfType(parent, "ConditionalExpression") &&
      (parent.consequent === expression || parent.alternate === expression)) ||
    (isNodeOfType(parent, "LogicalExpression") &&
      (parent.left === expression || parent.right === expression)) ||
    (isNodeOfType(parent, "ArrayExpression") &&
      parent.elements.some((element) => element === expression))
  ) {
    return isValueRenderedFromOwner(parent, renderOwner, scopes, visitedSymbolIds, options);
  }
  if (
    !isNodeOfType(parent, "VariableDeclarator") ||
    parent.init !== expression ||
    !isNodeOfType(parent.id, "Identifier")
  ) {
    return false;
  }
  const symbol = scopes.symbolFor(parent.id);
  if (
    !symbol ||
    symbol.kind !== "const" ||
    symbol.references.length === 0 ||
    visitedSymbolIds.has(symbol.id)
  ) {
    return false;
  }
  visitedSymbolIds.add(symbol.id);
  const isRendered = symbol.references.every(
    (reference) =>
      reference.flag === "read" &&
      isValueRenderedFromOwner(
        reference.identifier,
        renderOwner,
        scopes,
        visitedSymbolIds,
        options,
      ),
  );
  visitedSymbolIds.delete(symbol.id);
  return isRendered;
};

export const isValueRenderedInSameRender = (
  expressionNode: EsTreeNode,
  scopes: ScopeAnalysis,
  options: ValueRenderedInSameRenderOptions = {},
): boolean =>
  isValueRenderedFromOwner(
    expressionNode,
    findEnclosingFunction(expressionNode),
    scopes,
    new Set<number>(),
    options,
  );
