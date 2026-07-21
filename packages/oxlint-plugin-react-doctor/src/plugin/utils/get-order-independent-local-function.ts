import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getDestructuredBindingPropertyName } from "./get-destructured-binding-property-name.js";
import { getResolvedStaticPropertyName } from "./get-resolved-static-property-name.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import {
  hasPossibleStaticMemberCallWrite,
  hasPossibleStaticPropertyMutationOrEscape,
} from "./has-static-property-write-before.js";
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

const isOrderIndependentPromiseResolveCall = (
  expression: EsTreeNode,
  parameterNames: Set<string>,
  scopes: ScopeAnalysis,
): boolean => {
  const unwrappedExpression = stripParenExpression(expression);
  if (!isNodeOfType(unwrappedExpression, "CallExpression")) return false;
  if (
    !unwrappedExpression.arguments.every(
      (argument) =>
        !isNodeOfType(argument, "SpreadElement") &&
        isPureParameterExpression(argument, parameterNames),
    )
  ) {
    return false;
  }
  const callee = stripParenExpression(unwrappedExpression.callee);
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  if (getStaticPropertyName(callee) !== "resolve") return false;
  const receiver = stripParenExpression(callee.object);
  return (
    isNodeOfType(receiver, "Identifier") &&
    receiver.name === "Promise" &&
    scopes.isGlobalReference(receiver)
  );
};

const isHarmlessPromiseResolveAwait = (
  statement: EsTreeNode,
  parameterNames: Set<string>,
  scopes: ScopeAnalysis,
): boolean => {
  if (
    !isNodeOfType(statement, "ExpressionStatement") ||
    !isNodeOfType(statement.expression, "AwaitExpression")
  ) {
    return false;
  }
  return isOrderIndependentPromiseResolveCall(
    statement.expression.argument,
    parameterNames,
    scopes,
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
  if (!isFunctionLike(functionNode)) return false;
  const parameterNames = new Set<string>();
  for (const parameter of functionNode.params) {
    if (!isNodeOfType(parameter, "Identifier")) return false;
    parameterNames.add(parameter.name);
  }
  if (!functionNode.async) {
    if (!isNodeOfType(functionNode.body, "BlockStatement")) {
      return isOrderIndependentPromiseResolveCall(functionNode.body, parameterNames, scopes);
    }
    if (functionNode.body.body.length !== 1) return false;
    const [returnStatement] = functionNode.body.body;
    return Boolean(
      isNodeOfType(returnStatement, "ReturnStatement") &&
      returnStatement.argument &&
      isOrderIndependentPromiseResolveCall(returnStatement.argument, parameterNames, scopes),
    );
  }
  if (!isNodeOfType(functionNode.body, "BlockStatement")) {
    return isPureParameterExpression(functionNode.body, parameterNames);
  }
  const statements = functionNode.body.body;
  for (let statementIndex = 0; statementIndex < statements.length; statementIndex++) {
    const statement = statements[statementIndex];
    const isTerminalStatement = statementIndex === statements.length - 1;
    if (isHarmlessPromiseResolveAwait(statement, parameterNames, scopes)) continue;
    if (
      isNodeOfType(statement, "ExpressionStatement") &&
      isPureParameterExpression(statement.expression, parameterNames)
    ) {
      continue;
    }
    if (isCommutativeParameterMutation(statement, parameterNames)) return isTerminalStatement;
    if (!isNodeOfType(statement, "ReturnStatement") || !isTerminalStatement) return false;
    return (
      !statement.argument ||
      isPureParameterExpression(statement.argument, parameterNames) ||
      isOrderIndependentPromiseResolveCall(statement.argument, parameterNames, scopes)
    );
  }
  return true;
};

const getObjectPropertyName = (property: EsTreeNode, scopes: ScopeAnalysis): string | null => {
  if (!isNodeOfType(property, "Property")) return null;
  return getResolvedStaticPropertyName(property, scopes, { allowConstTemplateLiteral: true });
};

const resolveStaticMemberPropertyName = (
  memberExpression: EsTreeNode,
  scopes: ScopeAnalysis,
): string | null => {
  if (!isNodeOfType(memberExpression, "MemberExpression")) return null;
  return getResolvedStaticPropertyName(memberExpression, scopes, {
    allowConstTemplateLiteral: true,
  });
};

const resolveStaticObjectPropertyFunction = (
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
      hasSymbolWriteBefore(symbol, callExpression, scopes) ||
      hasPossibleStaticPropertyMutationOrEscape(unwrappedObject, propertyName, scopes)
    ) {
      return null;
    }
    visitedSymbolIds.add(symbol.id);
    return resolveStaticObjectPropertyFunction(
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
    if (property.kind !== "init") return null;
    const candidatePropertyName = getObjectPropertyName(property, scopes);
    if (candidatePropertyName === null) return null;
    if (candidatePropertyName === propertyName) matchingProperty = property;
  }
  if (!matchingProperty || !isNodeOfType(matchingProperty, "Property")) return null;
  const propertyValue = stripParenExpression(matchingProperty.value);
  if (isFunctionLike(propertyValue)) return propertyValue;
  return resolveStaticLocalFunction(propertyValue, callExpression, scopes, visitedSymbolIds);
};

const resolveStaticLocalFunction = (
  callee: EsTreeNode,
  callExpression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number>,
): EsTreeNode | null => {
  const unwrappedCallee = stripParenExpression(callee);
  if (isFunctionLike(unwrappedCallee)) return unwrappedCallee;
  if (isNodeOfType(unwrappedCallee, "MemberExpression")) {
    const propertyName = resolveStaticMemberPropertyName(unwrappedCallee, scopes);
    if (propertyName === null) return null;
    const receiver = stripParenExpression(unwrappedCallee.object);
    return resolveStaticObjectPropertyFunction(
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
  const destructuredPropertyName = getDestructuredBindingPropertyName(symbol.bindingIdentifier);
  if (destructuredPropertyName !== null) {
    return resolveStaticObjectPropertyFunction(
      initializer,
      destructuredPropertyName,
      callExpression,
      scopes,
      visitedSymbolIds,
    );
  }
  if (isFunctionLike(initializer)) return initializer;
  if (symbol.kind !== "const") return null;
  return resolveStaticLocalFunction(initializer, callExpression, scopes, visitedSymbolIds);
};

export const resolveStaticLocalCallFunction = (
  callExpression: EsTreeNode,
  scopes: ScopeAnalysis,
): EsTreeNode | null => {
  const unwrappedCall = stripParenExpression(callExpression);
  if (!isNodeOfType(unwrappedCall, "CallExpression")) return null;
  if (hasPossibleStaticMemberCallWrite(unwrappedCall, scopes)) return null;
  return resolveStaticLocalFunction(unwrappedCall.callee, unwrappedCall, scopes, new Set<number>());
};

export const getOrderIndependentLocalFunction = (
  callExpression: EsTreeNode,
  scopes: ScopeAnalysis,
): EsTreeNode | null => {
  const resolvedFunction = resolveStaticLocalCallFunction(callExpression, scopes);
  return resolvedFunction && isOrderIndependentFunction(resolvedFunction, scopes)
    ? resolvedFunction
    : null;
};
