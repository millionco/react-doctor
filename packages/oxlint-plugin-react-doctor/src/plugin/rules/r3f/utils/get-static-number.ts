import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";

export const getStaticNumber = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number> = new Set(),
): number | null => {
  const candidate = stripParenExpression(expression);
  if (isNodeOfType(candidate, "Literal") && typeof candidate.value === "number") {
    return candidate.value;
  }
  if (
    isNodeOfType(candidate, "UnaryExpression") &&
    (candidate.operator === "+" || candidate.operator === "-")
  ) {
    const operand = getStaticNumber(candidate.argument, scopes, new Set(visitedSymbolIds));
    if (operand === null) return null;
    return candidate.operator === "-" ? -operand : operand;
  }
  if (!isNodeOfType(candidate, "Identifier")) return null;
  const symbol = scopes.symbolFor(candidate);
  if (
    symbol?.kind !== "const" ||
    !symbol.initializer ||
    visitedSymbolIds.has(symbol.id) ||
    !isNodeOfType(symbol.declarationNode, "VariableDeclarator") ||
    symbol.declarationNode.id !== symbol.bindingIdentifier
  ) {
    return null;
  }
  visitedSymbolIds.add(symbol.id);
  return getStaticNumber(symbol.initializer, scopes, visitedSymbolIds);
};
