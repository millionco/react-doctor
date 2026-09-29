import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { resolveStaticLocalCallFunction } from "./get-order-independent-local-function.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

export const isLocalPromiseCollector = (
  call: EsTreeNode,
  promiseArray: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isNodeOfType(call, "CallExpression")) return false;
  const argumentIndex = call.arguments.findIndex((argument) => argument === promiseArray);
  if (
    argumentIndex < 0 ||
    call.arguments.some((argument) => isNodeOfType(argument, "SpreadElement"))
  ) {
    return false;
  }
  const collector = resolveStaticLocalCallFunction(call, scopes);
  if (!collector || !isFunctionLike(collector) || collector.generator) return false;
  const parameter = collector.params[argumentIndex];
  if (!isNodeOfType(parameter, "Identifier")) return false;
  const parameterSymbol = scopes.symbolFor(parameter);
  if (
    !parameterSymbol ||
    parameterSymbol.references.some((reference) => reference.flag !== "read")
  ) {
    return false;
  }

  let collectedExpression: EsTreeNode = collector.body;
  let isReturned = !isNodeOfType(collectedExpression, "BlockStatement");
  if (isNodeOfType(collectedExpression, "BlockStatement")) {
    const firstStatement = collectedExpression.body[0];
    if (isNodeOfType(firstStatement, "ReturnStatement")) {
      if (!firstStatement.argument) return false;
      collectedExpression = firstStatement.argument;
      isReturned = true;
    } else if (
      isNodeOfType(firstStatement, "VariableDeclaration") &&
      firstStatement.declarations.length === 1
    ) {
      const initializer = firstStatement.declarations[0].init;
      if (!initializer) return false;
      collectedExpression = initializer;
    } else if (isNodeOfType(firstStatement, "ExpressionStatement")) {
      collectedExpression = firstStatement.expression;
    } else {
      return false;
    }
  }
  collectedExpression = stripParenExpression(collectedExpression);
  if (isNodeOfType(collectedExpression, "AwaitExpression")) {
    collectedExpression = stripParenExpression(collectedExpression.argument);
  } else if (!isReturned) {
    return false;
  }
  if (!isNodeOfType(collectedExpression, "CallExpression")) return false;
  const callee = collectedExpression.callee;
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  if (
    !isNodeOfType(callee.object, "Identifier") ||
    callee.object.name !== "Promise" ||
    !scopes.isGlobalReference(callee.object)
  )
    return false;
  const methodName = getStaticPropertyName(callee);
  if (methodName !== "all" && methodName !== "allSettled") return false;
  const collectedArgument = collectedExpression.arguments[0];
  if (!collectedArgument) return false;
  const unwrappedArgument = stripParenExpression(collectedArgument);
  return (
    isNodeOfType(unwrappedArgument, "Identifier") &&
    scopes.symbolFor(unwrappedArgument) === parameterSymbol
  );
};
