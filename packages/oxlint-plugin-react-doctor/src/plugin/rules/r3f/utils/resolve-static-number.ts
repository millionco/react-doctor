import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";

export const resolveStaticNumber = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number> = new Set(),
): number | null => {
  const candidate = stripParenExpression(expression);
  if (isNodeOfType(candidate, "Literal") && typeof candidate.value === "number") {
    return Number.isFinite(candidate.value) ? candidate.value : null;
  }
  if (isNodeOfType(candidate, "Identifier")) {
    const symbol = scopes.symbolFor(candidate);
    if (
      symbol?.kind !== "const" ||
      !symbol.initializer ||
      visitedSymbolIds.has(symbol.id) ||
      symbol.references.some((reference) => reference.flag !== "read")
    ) {
      return null;
    }
    visitedSymbolIds.add(symbol.id);
    return resolveStaticNumber(symbol.initializer, scopes, visitedSymbolIds);
  }
  if (isNodeOfType(candidate, "UnaryExpression")) {
    const argument = resolveStaticNumber(candidate.argument, scopes, visitedSymbolIds);
    if (argument === null) return null;
    if (candidate.operator === "+") return argument;
    if (candidate.operator === "-") return -argument;
    return null;
  }
  if (!isNodeOfType(candidate, "BinaryExpression")) return null;
  const left = resolveStaticNumber(candidate.left, scopes, new Set(visitedSymbolIds));
  const right = resolveStaticNumber(candidate.right, scopes, new Set(visitedSymbolIds));
  if (left === null || right === null) return null;
  let result: number | null = null;
  if (candidate.operator === "+") result = left + right;
  if (candidate.operator === "-") result = left - right;
  if (candidate.operator === "*") result = left * right;
  if (candidate.operator === "/") result = left / right;
  if (candidate.operator === "**") result = left ** right;
  return result !== null && Number.isFinite(result) ? result : null;
};
