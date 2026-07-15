import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

export const isProvenGlobalObjectReference = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds = new Set<number>(),
): boolean => {
  const strippedExpression = stripParenExpression(expression);
  if (!isNodeOfType(strippedExpression, "Identifier")) return false;
  if (
    (strippedExpression.name === "globalThis" ||
      strippedExpression.name === "window" ||
      strippedExpression.name === "self" ||
      strippedExpression.name === "global") &&
    scopes.isGlobalReference(strippedExpression)
  ) {
    return true;
  }
  const symbol = scopes.symbolFor(strippedExpression);
  if (!symbol?.initializer || symbol.kind !== "const" || visitedSymbolIds.has(symbol.id)) {
    return false;
  }
  visitedSymbolIds.add(symbol.id);
  return isProvenGlobalObjectReference(symbol.initializer, scopes, visitedSymbolIds);
};

export const isProvenGlobalNamespaceReference = (
  expression: EsTreeNode,
  namespaceName: string,
  scopes: ScopeAnalysis,
  visitedSymbolIds = new Set<number>(),
): boolean => {
  const strippedExpression = stripParenExpression(expression);
  if (isNodeOfType(strippedExpression, "Identifier")) {
    if (strippedExpression.name === namespaceName && scopes.isGlobalReference(strippedExpression)) {
      return true;
    }
    const symbol = scopes.symbolFor(strippedExpression);
    if (!symbol?.initializer || symbol.kind !== "const" || visitedSymbolIds.has(symbol.id)) {
      return false;
    }
    visitedSymbolIds.add(symbol.id);
    return isProvenGlobalNamespaceReference(
      symbol.initializer,
      namespaceName,
      scopes,
      visitedSymbolIds,
    );
  }
  return (
    isNodeOfType(strippedExpression, "MemberExpression") &&
    getStaticPropertyName(strippedExpression) === namespaceName &&
    isProvenGlobalObjectReference(strippedExpression.object, scopes)
  );
};
