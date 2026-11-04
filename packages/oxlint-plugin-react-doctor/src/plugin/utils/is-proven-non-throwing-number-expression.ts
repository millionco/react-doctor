import { FUNCTION_RESOLUTION_MAX_DEPTH } from "../constants/thresholds.js";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getDirectConstInitializer } from "./get-direct-const-initializer.js";
import { isGlobalPerformanceNowCall } from "./is-global-performance-now-call.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

const NON_THROWING_NUMBER_BINARY_OPERATORS = new Set(["+", "-", "*", "/", "%", "**"]);

export const isProvenNonThrowingNumberExpression = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds = new Set<number>(),
  remainingDepth = FUNCTION_RESOLUTION_MAX_DEPTH,
): boolean => {
  if (remainingDepth <= 0) return false;
  const strippedExpression = stripParenExpression(expression);
  if (isNodeOfType(strippedExpression, "Literal")) {
    return typeof strippedExpression.value === "number";
  }
  if (isNodeOfType(strippedExpression, "CallExpression")) {
    return isGlobalPerformanceNowCall(strippedExpression, scopes);
  }
  if (isNodeOfType(strippedExpression, "Identifier")) {
    const symbol = scopes.symbolFor(strippedExpression);
    if (
      symbol?.kind !== "const" ||
      !symbol.initializer ||
      !getDirectConstInitializer(symbol) ||
      symbol.declarationNode.range[0] >= strippedExpression.range[0] ||
      visitedSymbolIds.has(symbol.id) ||
      symbol.references.some((reference) => reference.flag !== "read")
    ) {
      return false;
    }
    visitedSymbolIds.add(symbol.id);
    return isProvenNonThrowingNumberExpression(
      symbol.initializer,
      scopes,
      visitedSymbolIds,
      remainingDepth - 1,
    );
  }
  if (isNodeOfType(strippedExpression, "UnaryExpression")) {
    return (
      (strippedExpression.operator === "+" || strippedExpression.operator === "-") &&
      isProvenNonThrowingNumberExpression(
        strippedExpression.argument,
        scopes,
        visitedSymbolIds,
        remainingDepth - 1,
      )
    );
  }
  if (!isNodeOfType(strippedExpression, "BinaryExpression")) return false;
  if (!NON_THROWING_NUMBER_BINARY_OPERATORS.has(strippedExpression.operator)) return false;
  return (
    isProvenNonThrowingNumberExpression(
      strippedExpression.left,
      scopes,
      new Set(visitedSymbolIds),
      remainingDepth - 1,
    ) &&
    isProvenNonThrowingNumberExpression(
      strippedExpression.right,
      scopes,
      new Set(visitedSymbolIds),
      remainingDepth - 1,
    )
  );
};
