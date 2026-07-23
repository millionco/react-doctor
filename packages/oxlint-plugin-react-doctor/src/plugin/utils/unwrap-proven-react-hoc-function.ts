import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { hasSymbolWriteBefore } from "./has-symbol-write-before.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isReactApiCall } from "./is-react-api-call.js";
import { stripParenExpression } from "./strip-paren-expression.js";

export const unwrapProvenReactHocFunction = (
  node: EsTreeNode | null | undefined,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number> = new Set(),
): EsTreeNode | null => {
  if (!node) return null;
  const expression = stripParenExpression(node);
  if (isFunctionLike(expression)) return expression;
  if (isNodeOfType(expression, "Identifier")) {
    const symbol = scopes.symbolFor(expression);
    if (
      !symbol ||
      visitedSymbolIds.has(symbol.id) ||
      !symbol.initializer ||
      hasSymbolWriteBefore(symbol, expression, scopes)
    ) {
      return null;
    }
    visitedSymbolIds.add(symbol.id);
    return unwrapProvenReactHocFunction(symbol.initializer, scopes, visitedSymbolIds);
  }
  if (
    !isNodeOfType(expression, "CallExpression") ||
    (!isReactApiCall(expression, "memo", scopes, { resolveNamedAliases: true }) &&
      !isReactApiCall(expression, "forwardRef", scopes, { resolveNamedAliases: true }))
  ) {
    return null;
  }
  const componentArgument = expression.arguments[0];
  if (!componentArgument || isNodeOfType(componentArgument, "SpreadElement")) return null;
  return unwrapProvenReactHocFunction(componentArgument, scopes, visitedSymbolIds);
};
