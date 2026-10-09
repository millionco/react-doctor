import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { resolveExactLocalFunction } from "./resolve-exact-local-function.js";
import { stripParenExpression } from "./strip-paren-expression.js";

const functionStopsEventPropagation = (
  handler: EsTreeNode,
  eventParameterIndex: number,
  scopes: ScopeAnalysis,
  visitedFunctions: Set<EsTreeNode>,
): boolean => {
  if (!isFunctionLike(handler) || handler.generator || visitedFunctions.has(handler)) return false;
  visitedFunctions.add(handler);
  const eventParameter = handler.params[eventParameterIndex];
  if (!isNodeOfType(eventParameter, "Identifier")) return false;
  const eventSymbol = scopes.symbolFor(eventParameter);
  if (!eventSymbol) return false;
  let expression = stripParenExpression(handler.body);
  if (isNodeOfType(expression, "BlockStatement")) {
    const firstStatement = expression.body[0];
    if (isNodeOfType(firstStatement, "ExpressionStatement")) expression = firstStatement.expression;
    else if (isNodeOfType(firstStatement, "ReturnStatement") && firstStatement.argument)
      expression = firstStatement.argument;
    else return false;
  }
  expression = stripParenExpression(expression);
  if (!isNodeOfType(expression, "CallExpression") || expression.optional) return false;
  if (
    isNodeOfType(expression.callee, "MemberExpression") &&
    getStaticPropertyName(expression.callee) === "stopPropagation" &&
    isNodeOfType(expression.callee.object, "Identifier") &&
    scopes.symbolFor(expression.callee.object) === eventSymbol
  )
    return true;
  const delegate = resolveExactLocalFunction(expression.callee, scopes);
  if (!delegate) return false;
  return expression.arguments.some(
    (argument, argumentIndex) =>
      isNodeOfType(argument, "Identifier") &&
      scopes.symbolFor(argument) === eventSymbol &&
      functionStopsEventPropagation(delegate, argumentIndex, scopes, new Set(visitedFunctions)),
  );
};

export const handlerStopsEventPropagation = (
  attribute: EsTreeNodeOfType<"JSXAttribute">,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isNodeOfType(attribute.value, "JSXExpressionContainer")) return false;
  const handler = resolveExactLocalFunction(attribute.value.expression, scopes);
  return Boolean(handler && functionStopsEventPropagation(handler, 0, scopes, new Set()));
};
