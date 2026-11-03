import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

export const hasLogicalReceiverOrigin = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds = new Set<number>(),
): boolean => {
  const receiver = stripParenExpression(expression);
  if (isNodeOfType(receiver, "LogicalExpression")) return true;
  if (isNodeOfType(receiver, "MemberExpression")) {
    return hasLogicalReceiverOrigin(receiver.object, scopes, visitedSymbolIds);
  }
  if (isNodeOfType(receiver, "CallExpression")) {
    const callee = stripParenExpression(receiver.callee);
    return (
      isNodeOfType(callee, "MemberExpression") &&
      hasLogicalReceiverOrigin(callee.object, scopes, visitedSymbolIds)
    );
  }
  if (!isNodeOfType(receiver, "Identifier")) return false;
  const symbol = scopes.symbolFor(receiver);
  if (!symbol?.initializer || visitedSymbolIds.has(symbol.id)) return false;
  visitedSymbolIds.add(symbol.id);
  return hasLogicalReceiverOrigin(symbol.initializer, scopes, visitedSymbolIds);
};
