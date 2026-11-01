import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getDirectConstInitializer } from "./get-direct-const-initializer.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { hasPossibleStaticPropertyMutationOrEscape } from "./has-static-property-write-before.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isProvenUnmodifiedGlobalNamespaceReference } from "./is-proven-unmodified-global-namespace-reference.js";
import { isSymbolReadOnly } from "./is-symbol-read-only.js";
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

interface ProvenPromiseExpressionOptions {
  allowAsyncFunctions?: boolean;
  requireUnmodifiedGlobalPromise?: boolean;
}

export const isProvenPromiseExpression = (
  rawExpression: EsTreeNode,
  scopes: ScopeAnalysis,
  options: ProvenPromiseExpressionOptions = {},
  visitedSymbolIds: Set<number> = new Set(),
): boolean => {
  const isAsyncFunctionReference = (
    rawFunctionExpression: EsTreeNode,
    functionVisitedSymbolIds: Set<number>,
  ): boolean => {
    const functionExpression = stripParenExpression(rawFunctionExpression);
    if (isFunctionLike(functionExpression)) {
      return functionExpression.async && !functionExpression.generator;
    }
    if (!isNodeOfType(functionExpression, "Identifier")) return false;
    const functionSymbol = scopes.symbolFor(functionExpression);
    if (
      !functionSymbol ||
      functionVisitedSymbolIds.has(functionSymbol.id) ||
      !isSymbolReadOnly(functionSymbol)
    ) {
      return false;
    }
    const candidate =
      functionSymbol.kind === "function"
        ? functionSymbol.declarationNode
        : getDirectConstInitializer(functionSymbol);
    if (!candidate) return false;
    const nextVisitedSymbolIds = new Set(functionVisitedSymbolIds);
    nextVisitedSymbolIds.add(functionSymbol.id);
    return isAsyncFunctionReference(candidate, nextVisitedSymbolIds);
  };

  const expression = stripParenExpression(rawExpression);
  if (isNodeOfType(expression, "Identifier")) {
    const symbol = scopes.symbolFor(expression);
    const initializer = symbol ? getDirectConstInitializer(symbol) : null;
    if (!symbol || !initializer || visitedSymbolIds.has(symbol.id) || !isSymbolReadOnly(symbol)) {
      return false;
    }
    const nextVisitedSymbolIds = new Set(visitedSymbolIds);
    nextVisitedSymbolIds.add(symbol.id);
    return isProvenPromiseExpression(initializer, scopes, options, nextVisitedSymbolIds);
  }
  if (isNodeOfType(expression, "NewExpression")) {
    const callee = stripParenExpression(expression.callee);
    return (
      isNodeOfType(callee, "Identifier") &&
      callee.name === "Promise" &&
      scopes.isGlobalReference(callee) &&
      (!options.requireUnmodifiedGlobalPromise ||
        isProvenUnmodifiedGlobalNamespaceReference(callee, "Promise", scopes, undefined, true))
    );
  }
  if (!isNodeOfType(expression, "CallExpression")) return false;
  const callee = stripParenExpression(expression.callee);
  if (isNodeOfType(callee, "Identifier")) {
    return (
      options.allowAsyncFunctions !== false && isAsyncFunctionReference(callee, visitedSymbolIds)
    );
  }
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  const calleeObject = stripParenExpression(callee.object);
  const methodName = getStaticPropertyName(callee);
  if (PROMISE_DEFERRED_METHOD_NAMES.has(methodName ?? "")) {
    if (
      methodName &&
      (hasPossibleStaticPropertyMutationOrEscape(calleeObject, methodName, scopes) ||
        hasPossibleStaticPropertyMutationOrEscape(calleeObject, "constructor", scopes))
    ) {
      return false;
    }
    return isProvenPromiseExpression(callee.object, scopes, options, visitedSymbolIds);
  }
  return Boolean(
    PROMISE_FACTORY_METHOD_NAMES.has(methodName ?? "") &&
    isNodeOfType(calleeObject, "Identifier") &&
    calleeObject.name === "Promise" &&
    scopes.isGlobalReference(calleeObject) &&
    isProvenUnmodifiedGlobalNamespaceReference(
      calleeObject,
      "Promise",
      scopes,
      options.requireUnmodifiedGlobalPromise ? undefined : (methodName ?? undefined),
      options.requireUnmodifiedGlobalPromise,
    ),
  );
};
