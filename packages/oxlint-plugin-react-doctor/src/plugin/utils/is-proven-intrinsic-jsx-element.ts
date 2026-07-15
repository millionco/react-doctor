import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { resolveJsxElementType } from "./resolve-jsx-element-type.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";

export const isProvenIntrinsicJsxElement = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isNodeOfType(openingElement.name, "JSXIdentifier")) return false;
  const resolvedElementType = resolveJsxElementType(openingElement);
  if (resolvedElementType[0] === resolvedElementType[0]?.toLowerCase()) return true;
  const visitedSymbolIds = new Set<number>();
  const isIntrinsicValue = (node: EsTreeNode): boolean => {
    const current = findTransparentExpressionRoot(node);
    if (isNodeOfType(current, "Literal")) return typeof current.value === "string";
    if (isNodeOfType(current, "Identifier") || isNodeOfType(current, "JSXIdentifier")) {
      const symbol = scopes.symbolFor(current);
      if (
        !symbol ||
        symbol.kind !== "const" ||
        !symbol.initializer ||
        visitedSymbolIds.has(symbol.id)
      ) {
        return false;
      }
      visitedSymbolIds.add(symbol.id);
      const isIntrinsic = isIntrinsicValue(symbol.initializer);
      visitedSymbolIds.delete(symbol.id);
      return isIntrinsic;
    }
    if (isNodeOfType(current, "ConditionalExpression")) {
      return isIntrinsicValue(current.consequent) && isIntrinsicValue(current.alternate);
    }
    return false;
  };
  return isIntrinsicValue(openingElement.name);
};
