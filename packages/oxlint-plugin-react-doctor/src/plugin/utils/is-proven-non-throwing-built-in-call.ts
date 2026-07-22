import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

const NON_THROWING_CONSOLE_METHOD_NAMES = new Set([
  "debug",
  "error",
  "info",
  "log",
  "trace",
  "warn",
]);
const NON_THROWING_NUMBER_BINARY_OPERATORS = new Set(["+", "-", "*", "/", "%", "**"]);

const isGlobalPerformanceNowCall = (
  callNode: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
): boolean => {
  const callee = stripParenExpression(callNode.callee);
  if (!isNodeOfType(callee, "MemberExpression") || callNode.arguments.length !== 0) return false;
  const receiver = stripParenExpression(callee.object);
  return (
    isNodeOfType(receiver, "Identifier") &&
    receiver.name === "performance" &&
    scopes.isGlobalReference(receiver) &&
    getStaticPropertyName(callee) === "now"
  );
};

const isProvenNonThrowingNumberExpression = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds = new Set<number>(),
): boolean => {
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
      symbol.declarationNode.range[0] >= strippedExpression.range[0] ||
      visitedSymbolIds.has(symbol.id) ||
      symbol.references.some((reference) => reference.flag !== "read")
    ) {
      return false;
    }
    visitedSymbolIds.add(symbol.id);
    return isProvenNonThrowingNumberExpression(symbol.initializer, scopes, visitedSymbolIds);
  }
  if (isNodeOfType(strippedExpression, "UnaryExpression")) {
    return (
      (strippedExpression.operator === "+" || strippedExpression.operator === "-") &&
      isProvenNonThrowingNumberExpression(strippedExpression.argument, scopes, visitedSymbolIds)
    );
  }
  if (!isNodeOfType(strippedExpression, "BinaryExpression")) return false;
  if (!NON_THROWING_NUMBER_BINARY_OPERATORS.has(strippedExpression.operator)) return false;
  return (
    isProvenNonThrowingNumberExpression(
      strippedExpression.left,
      scopes,
      new Set(visitedSymbolIds),
    ) &&
    isProvenNonThrowingNumberExpression(strippedExpression.right, scopes, new Set(visitedSymbolIds))
  );
};

export const isProvenNonThrowingBuiltInCall = (
  callNode: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
): boolean => {
  if (isGlobalPerformanceNowCall(callNode, scopes)) return true;
  const callee = stripParenExpression(callNode.callee);
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  const receiver = stripParenExpression(callee.object);
  if (!isNodeOfType(receiver, "Identifier") || !scopes.isGlobalReference(receiver)) return false;
  const methodName = getStaticPropertyName(callee);
  if (receiver.name === "console") {
    return NON_THROWING_CONSOLE_METHOD_NAMES.has(methodName ?? "");
  }
  const firstArgument = callNode.arguments[0];
  return Boolean(
    receiver.name === "Math" &&
    methodName === "round" &&
    callNode.arguments.length === 1 &&
    firstArgument &&
    isProvenNonThrowingNumberExpression(firstArgument, scopes),
  );
};
