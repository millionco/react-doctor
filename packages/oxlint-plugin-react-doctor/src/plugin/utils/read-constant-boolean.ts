import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getDirectConstInitializer } from "./get-direct-const-initializer.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { readStaticBoolean } from "./read-static-boolean.js";
import { stripParenExpression } from "./strip-paren-expression.js";

export const readConstantBoolean = (
  node: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbols = new Set<number>(),
): boolean | null => {
  const expression = stripParenExpression(node);
  const literalBoolean = readStaticBoolean(expression);
  if (literalBoolean !== null) return literalBoolean;
  if (isNodeOfType(expression, "Literal")) {
    if ("regex" in expression && expression.regex) return true;
    if (
      expression.value === null ||
      typeof expression.value === "string" ||
      typeof expression.value === "number" ||
      typeof expression.value === "bigint"
    ) {
      return Boolean(expression.value);
    }
  }
  if (isNodeOfType(expression, "UnaryExpression") && expression.operator === "!") {
    const argumentValue = readConstantBoolean(expression.argument, scopes, visitedSymbols);
    return argumentValue === null ? null : !argumentValue;
  }
  if (isNodeOfType(expression, "LogicalExpression")) {
    const leftValue = readConstantBoolean(expression.left, scopes, new Set(visitedSymbols));
    const rightValue = readConstantBoolean(expression.right, scopes, new Set(visitedSymbols));
    if (expression.operator === "&&") {
      if (leftValue === false || rightValue === false) return false;
      return leftValue === true && rightValue === true ? true : null;
    }
    if (expression.operator === "||") {
      if (leftValue === true || rightValue === true) return true;
      return leftValue === false && rightValue === false ? false : null;
    }
    return null;
  }
  if (!isNodeOfType(expression, "Identifier")) return null;
  const symbol = scopes.symbolFor(expression);
  const initializer = symbol && getDirectConstInitializer(symbol);
  if (!symbol || !initializer || visitedSymbols.has(symbol.id)) return null;
  visitedSymbols.add(symbol.id);
  return readConstantBoolean(initializer, scopes, visitedSymbols);
};
