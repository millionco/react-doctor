import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { hasPossibleStaticMemberCallWrite } from "./has-static-property-write-before.js";
import { hasSymbolWriteBefore } from "./has-symbol-write-before.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

const COMMUTATIVE_COMPOUND_ASSIGNMENT_OPERATORS: ReadonlySet<string> = new Set([
  "+=",
  "-=",
  "*=",
  "/=",
  "%=",
  "&=",
  "^=",
  "|=",
]);

const isPureParameterExpression = (
  expression: EsTreeNode,
  parameterNames: Set<string>,
): boolean => {
  const unwrappedExpression = stripParenExpression(expression);
  if (isNodeOfType(unwrappedExpression, "Literal")) return true;
  if (isNodeOfType(unwrappedExpression, "Identifier")) {
    return parameterNames.has(unwrappedExpression.name);
  }
  if (
    isNodeOfType(unwrappedExpression, "BinaryExpression") ||
    isNodeOfType(unwrappedExpression, "LogicalExpression")
  ) {
    return (
      isPureParameterExpression(unwrappedExpression.left, parameterNames) &&
      isPureParameterExpression(unwrappedExpression.right, parameterNames)
    );
  }
  if (isNodeOfType(unwrappedExpression, "UnaryExpression")) {
    return (
      unwrappedExpression.operator !== "delete" &&
      isPureParameterExpression(unwrappedExpression.argument, parameterNames)
    );
  }
  if (isNodeOfType(unwrappedExpression, "ConditionalExpression")) {
    return (
      isPureParameterExpression(unwrappedExpression.test, parameterNames) &&
      isPureParameterExpression(unwrappedExpression.consequent, parameterNames) &&
      isPureParameterExpression(unwrappedExpression.alternate, parameterNames)
    );
  }
  if (isNodeOfType(unwrappedExpression, "TemplateLiteral")) {
    return unwrappedExpression.expressions.every((nestedExpression) =>
      isPureParameterExpression(nestedExpression, parameterNames),
    );
  }
  return false;
};

const isHarmlessPromiseResolveAwait = (statement: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (
    !isNodeOfType(statement, "ExpressionStatement") ||
    !isNodeOfType(statement.expression, "AwaitExpression")
  ) {
    return false;
  }
  const awaitedExpression = stripParenExpression(statement.expression.argument);
  if (!isNodeOfType(awaitedExpression, "CallExpression")) return false;
  if (awaitedExpression.arguments.length !== 0) return false;
  const callee = stripParenExpression(awaitedExpression.callee);
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  if (getStaticPropertyName(callee) !== "resolve") return false;
  const receiver = stripParenExpression(callee.object);
  return (
    isNodeOfType(receiver, "Identifier") &&
    receiver.name === "Promise" &&
    scopes.isGlobalReference(receiver)
  );
};

const isCommutativeParameterMutation = (
  statement: EsTreeNode,
  parameterNames: Set<string>,
): boolean => {
  if (
    !isNodeOfType(statement, "ExpressionStatement") ||
    !isNodeOfType(statement.expression, "AssignmentExpression") ||
    !COMMUTATIVE_COMPOUND_ASSIGNMENT_OPERATORS.has(statement.expression.operator)
  ) {
    return false;
  }
  const mutationTarget = stripParenExpression(statement.expression.left);
  if (!isNodeOfType(mutationTarget, "MemberExpression")) return false;
  if (getStaticPropertyName(mutationTarget) === null) return false;
  const receiver = stripParenExpression(mutationTarget.object);
  return (
    isNodeOfType(receiver, "Identifier") &&
    parameterNames.has(receiver.name) &&
    isNodeOfType(stripParenExpression(statement.expression.right), "Literal")
  );
};

const isOrderIndependentFunction = (functionNode: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (!isFunctionLike(functionNode) || !functionNode.async) return false;
  const parameterNames = new Set<string>();
  for (const parameter of functionNode.params) {
    if (!isNodeOfType(parameter, "Identifier")) return false;
    parameterNames.add(parameter.name);
  }
  if (!isNodeOfType(functionNode.body, "BlockStatement")) {
    return isPureParameterExpression(functionNode.body, parameterNames);
  }
  const statements = functionNode.body.body;
  let statementIndex = 0;
  while (statementIndex < statements.length - 1) {
    const statement = statements[statementIndex];
    if (
      !isHarmlessPromiseResolveAwait(statement, scopes) &&
      (!isNodeOfType(statement, "ExpressionStatement") ||
        !isPureParameterExpression(statement.expression, parameterNames))
    ) {
      break;
    }
    statementIndex++;
  }
  if (statementIndex !== statements.length - 1) return false;
  const terminalStatement = statements[statementIndex];
  if (isNodeOfType(terminalStatement, "ReturnStatement") && terminalStatement.argument) {
    return isPureParameterExpression(terminalStatement.argument, parameterNames);
  }
  return isCommutativeParameterMutation(terminalStatement, parameterNames);
};

const getObjectPropertyName = (property: EsTreeNode): string | null => {
  if (!isNodeOfType(property, "Property")) return null;
  if (!property.computed && isNodeOfType(property.key, "Identifier")) return property.key.name;
  if (property.computed && isNodeOfType(property.key, "Literal")) {
    return typeof property.key.value === "string" ? property.key.value : null;
  }
  return null;
};

const resolveOrderIndependentObjectPropertyFunction = (
  objectExpression: EsTreeNode,
  propertyName: string,
  callExpression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number>,
): EsTreeNode | null => {
  const unwrappedObject = stripParenExpression(objectExpression);
  if (isNodeOfType(unwrappedObject, "Identifier")) {
    const symbol = scopes.symbolFor(unwrappedObject);
    if (
      !symbol ||
      symbol.kind !== "const" ||
      !symbol.initializer ||
      visitedSymbolIds.has(symbol.id) ||
      hasSymbolWriteBefore(symbol, callExpression, scopes)
    ) {
      return null;
    }
    visitedSymbolIds.add(symbol.id);
    return resolveOrderIndependentObjectPropertyFunction(
      symbol.initializer,
      propertyName,
      callExpression,
      scopes,
      visitedSymbolIds,
    );
  }
  if (!isNodeOfType(unwrappedObject, "ObjectExpression")) return null;
  let matchingProperty: EsTreeNode | null = null;
  for (const property of unwrappedObject.properties) {
    if (!isNodeOfType(property, "Property")) return null;
    const candidatePropertyName = getObjectPropertyName(property);
    if (candidatePropertyName === null) return null;
    if (candidatePropertyName === propertyName) matchingProperty = property;
  }
  if (!matchingProperty || !isNodeOfType(matchingProperty, "Property")) return null;
  const propertyValue = stripParenExpression(matchingProperty.value);
  if (isFunctionLike(propertyValue)) {
    return isOrderIndependentFunction(propertyValue, scopes) ? propertyValue : null;
  }
  return resolveOrderIndependentLocalFunction(
    propertyValue,
    callExpression,
    scopes,
    visitedSymbolIds,
  );
};

const resolveOrderIndependentLocalFunction = (
  callee: EsTreeNode,
  callExpression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number>,
): EsTreeNode | null => {
  const unwrappedCallee = stripParenExpression(callee);
  if (isNodeOfType(unwrappedCallee, "MemberExpression")) {
    const propertyName = getStaticPropertyName(unwrappedCallee);
    if (!propertyName) return null;
    const receiver = stripParenExpression(unwrappedCallee.object);
    return resolveOrderIndependentObjectPropertyFunction(
      receiver,
      propertyName,
      callExpression,
      scopes,
      visitedSymbolIds,
    );
  }
  if (!isNodeOfType(unwrappedCallee, "Identifier")) return null;
  const symbol = scopes.symbolFor(unwrappedCallee);
  if (
    !symbol ||
    visitedSymbolIds.has(symbol.id) ||
    hasSymbolWriteBefore(symbol, callExpression, scopes)
  ) {
    return null;
  }
  visitedSymbolIds.add(symbol.id);
  if (!symbol.initializer) return null;
  const initializer = stripParenExpression(symbol.initializer);
  if (isFunctionLike(initializer)) {
    return isOrderIndependentFunction(initializer, scopes) ? initializer : null;
  }
  if (symbol.kind !== "const") return null;
  return resolveOrderIndependentLocalFunction(
    initializer,
    callExpression,
    scopes,
    visitedSymbolIds,
  );
};

export const getOrderIndependentLocalFunction = (
  callExpression: EsTreeNode,
  scopes: ScopeAnalysis,
): EsTreeNode | null => {
  const unwrappedCall = stripParenExpression(callExpression);
  if (!isNodeOfType(unwrappedCall, "CallExpression")) return null;
  if (hasPossibleStaticMemberCallWrite(unwrappedCall, scopes)) return null;
  return resolveOrderIndependentLocalFunction(
    unwrappedCall.callee,
    unwrappedCall,
    scopes,
    new Set<number>(),
  );
};
