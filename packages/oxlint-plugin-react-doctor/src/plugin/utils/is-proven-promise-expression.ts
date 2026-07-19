import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

const PROMISE_FACTORY_METHOD_NAMES = new Set([
  "all",
  "allSettled",
  "any",
  "race",
  "reject",
  "resolve",
]);
const PROMISE_DEFERRED_METHOD_NAMES = new Set(["catch", "finally", "then"]);

export const isProvenPromiseExpression = (
  rawExpression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number> = new Set(),
): boolean => {
  const isAsyncFunctionReference = (
    rawFunctionExpression: EsTreeNode,
    functionVisitedSymbolIds: Set<number>,
  ): boolean => {
    const functionExpression = stripParenExpression(rawFunctionExpression);
    if (isFunctionLike(functionExpression)) return functionExpression.async;
    if (!isNodeOfType(functionExpression, "Identifier")) return false;
    const functionSymbol = scopes.symbolFor(functionExpression);
    if (!functionSymbol || functionVisitedSymbolIds.has(functionSymbol.id)) return false;
    const candidate = functionSymbol.initializer ?? functionSymbol.declarationNode;
    const nextVisitedSymbolIds = new Set(functionVisitedSymbolIds);
    nextVisitedSymbolIds.add(functionSymbol.id);
    return isAsyncFunctionReference(candidate, nextVisitedSymbolIds);
  };

  const expression = stripParenExpression(rawExpression);
  if (isNodeOfType(expression, "Identifier")) {
    const symbol = scopes.symbolFor(expression);
    if (!symbol || !symbol.initializer || visitedSymbolIds.has(symbol.id)) return false;
    const nextVisitedSymbolIds = new Set(visitedSymbolIds);
    nextVisitedSymbolIds.add(symbol.id);
    return isProvenPromiseExpression(symbol.initializer, scopes, nextVisitedSymbolIds);
  }
  if (isNodeOfType(expression, "NewExpression")) {
    const callee = stripParenExpression(expression.callee);
    return (
      isNodeOfType(callee, "Identifier") &&
      callee.name === "Promise" &&
      scopes.isGlobalReference(callee)
    );
  }
  if (!isNodeOfType(expression, "CallExpression")) return false;
  const callee = stripParenExpression(expression.callee);
  if (isNodeOfType(callee, "Identifier")) {
    return isAsyncFunctionReference(callee, visitedSymbolIds);
  }
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  const calleeObject = stripParenExpression(callee.object);
  if (PROMISE_DEFERRED_METHOD_NAMES.has(getStaticPropertyName(callee) ?? "")) {
    return isProvenPromiseExpression(callee.object, scopes, visitedSymbolIds);
  }
  return Boolean(
    PROMISE_FACTORY_METHOD_NAMES.has(getStaticPropertyName(callee) ?? "") &&
    isNodeOfType(calleeObject, "Identifier") &&
    calleeObject.name === "Promise" &&
    scopes.isGlobalReference(calleeObject),
  );
};
