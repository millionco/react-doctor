import { HTML_TAGS } from "../../../constants/html-tags.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { getAuthoritativeJsxAttribute } from "../../../utils/get-authoritative-jsx-attribute.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { serializeReferenceKey } from "../../../utils/serialize-reference-key.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";

export interface NullDetachActionInput {
  attribute: EsTreeNode;
  scopes: ScopeAnalysis;
}

export interface StoreAction {
  receiver: EsTreeNode;
  key: EsTreeNode;
  value: EsTreeNode | null;
}

const readonlyExternalBindings = new WeakMap<SymbolDescriptor, boolean>();

export const getSingleStatement = (statement: EsTreeNode | null | undefined): EsTreeNode | null => {
  if (!statement) return null;
  if (!isNodeOfType(statement, "BlockStatement")) return statement;
  const [onlyStatement, ...remainingStatements] = statement.body;
  return onlyStatement && !remainingStatements.length ? onlyStatement : null;
};

export const readStoreAction = (
  action: EsTreeNode | null | undefined,
  methodName: string,
): StoreAction | null => {
  if (!action) return null;
  const call = stripParenExpression(
    isNodeOfType(action, "ExpressionStatement") ? action.expression : action,
  );
  if (!isNodeOfType(call, "CallExpression") || call.optional) return null;
  const callee = stripParenExpression(call.callee);
  if (
    !isNodeOfType(callee, "MemberExpression") ||
    callee.optional ||
    callee.computed ||
    !isNodeOfType(callee.property, "Identifier") ||
    callee.property.name !== methodName
  )
    return null;
  const [key, ...remainingArguments] = call.arguments;
  if (!key || isNodeOfType(key, "SpreadElement")) return null;
  if (methodName === "delete" || methodName === "get") {
    return remainingArguments.length ? null : { receiver: callee.object, key, value: null };
  }
  const [value, ...extraArguments] = remainingArguments;
  return value && !isNodeOfType(value, "SpreadElement") && !extraArguments.length
    ? { receiver: callee.object, key, value }
    : null;
};

export const getExternalReferenceKey = (
  rawExpression: EsTreeNode,
  callback: EsTreeNode,
  scopes: ScopeAnalysis,
): string | null => {
  let expression = stripParenExpression(rawExpression);
  while (isNodeOfType(expression, "MemberExpression")) {
    if (
      expression.optional ||
      expression.computed ||
      !isNodeOfType(expression.property, "Identifier")
    )
      return null;
    expression = stripParenExpression(expression.object);
  }
  if (!isNodeOfType(expression, "Identifier")) return null;
  const symbol = scopes.symbolFor(expression);
  if (!symbol) return null;
  let readonly = readonlyExternalBindings.get(symbol);
  if (readonly === undefined) {
    readonly = !symbol.references.some((reference) => reference.flag !== "read");
    readonlyExternalBindings.set(symbol, readonly);
  }
  if (!readonly) return null;
  let declarationAncestor: EsTreeNode | null | undefined = symbol.declarationNode;
  while (declarationAncestor) {
    if (declarationAncestor === callback) return null;
    declarationAncestor = declarationAncestor.parent;
  }
  return serializeReferenceKey({ node: rawExpression, scopes });
};

const targetSameStoreEntry = (
  firstAction: StoreAction,
  secondAction: StoreAction,
  callback: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const receiverKey = getExternalReferenceKey(firstAction.receiver, callback, scopes);
  if (
    !receiverKey ||
    receiverKey !== getExternalReferenceKey(secondAction.receiver, callback, scopes)
  )
    return false;
  const firstKey = stripParenExpression(firstAction.key);
  const secondKey = stripParenExpression(secondAction.key);
  if (isNodeOfType(firstKey, "Literal") || isNodeOfType(secondKey, "Literal")) {
    return (
      isNodeOfType(firstKey, "Literal") &&
      isNodeOfType(secondKey, "Literal") &&
      typeof firstKey.value === "string" &&
      firstKey.value === secondKey.value
    );
  }
  const keyReference = getExternalReferenceKey(firstKey, callback, scopes);
  return Boolean(
    keyReference && keyReference === getExternalReferenceKey(secondKey, callback, scopes),
  );
};

export const readReturnedAction = (
  statement: EsTreeNode | null | undefined,
): StoreAction | null => {
  if (!statement || !isNodeOfType(statement, "ReturnStatement") || !statement.argument) return null;
  const returnedFunction = stripParenExpression(statement.argument);
  if (
    !isNodeOfType(returnedFunction, "ArrowFunctionExpression") ||
    returnedFunction.async ||
    returnedFunction.params.length
  )
    return null;
  if (isNodeOfType(returnedFunction.body, "BlockStatement")) {
    return readStoreAction(getSingleStatement(returnedFunction.body), "delete");
  }
  return readStoreAction(returnedFunction.body, "delete");
};

export const hasEquivalentNullDetachAction = ({
  attribute,
  scopes,
}: NullDetachActionInput): boolean => {
  const openingElement = attribute.parent;
  if (
    !openingElement ||
    !isNodeOfType(openingElement, "JSXOpeningElement") ||
    !isNodeOfType(openingElement.name, "JSXIdentifier") ||
    !HTML_TAGS.has(openingElement.name.name) ||
    getAuthoritativeJsxAttribute(openingElement.attributes, "ref") !== attribute ||
    !isNodeOfType(attribute, "JSXAttribute") ||
    !attribute.value ||
    !isNodeOfType(attribute.value, "JSXExpressionContainer")
  )
    return false;
  const callback = stripParenExpression(attribute.value.expression);
  if (
    !isNodeOfType(callback, "ArrowFunctionExpression") ||
    callback.async ||
    !isNodeOfType(callback.body, "BlockStatement")
  )
    return false;
  const [input, ...extraParameters] = callback.params;
  if (!input || !isNodeOfType(input, "Identifier") || extraParameters.length) return false;
  const inputSymbol = scopes.symbolFor(input);
  if (!inputSymbol || inputSymbol.references.some((reference) => reference.flag !== "read"))
    return false;
  const [guard, nextStatement, lastStatement, ...remainingStatements] = callback.body.body;
  if (!guard || !isNodeOfType(guard, "IfStatement") || remainingStatements.length) return false;
  const test = stripParenExpression(guard.test);
  let registration: StoreAction | null;
  let detachment: StoreAction | null;
  let cleanup: StoreAction | null;
  if (isNodeOfType(test, "Identifier") && scopes.symbolFor(test) === inputSymbol) {
    if (!guard.alternate || lastStatement) return false;
    registration = readStoreAction(getSingleStatement(guard.consequent), "set");
    detachment = readStoreAction(getSingleStatement(guard.alternate), "delete");
    cleanup = readReturnedAction(nextStatement);
  } else if (isNodeOfType(test, "UnaryExpression") && test.operator === "!") {
    const negatedInput = stripParenExpression(test.argument);
    if (
      !isNodeOfType(negatedInput, "Identifier") ||
      scopes.symbolFor(negatedInput) !== inputSymbol ||
      guard.alternate ||
      !isNodeOfType(guard.consequent, "BlockStatement")
    )
      return false;
    const [releaseStatement, returnStatement, ...extraStatements] = guard.consequent.body;
    if (
      extraStatements.length ||
      !returnStatement ||
      !isNodeOfType(returnStatement, "ReturnStatement") ||
      returnStatement.argument
    )
      return false;
    detachment = readStoreAction(releaseStatement, "delete");
    registration = readStoreAction(nextStatement, "set");
    cleanup = readReturnedAction(lastStatement);
  } else return false;
  if (!registration?.value || !detachment || !cleanup) return false;
  const attachedValue = stripParenExpression(registration.value);
  return (
    isNodeOfType(attachedValue, "Identifier") &&
    scopes.symbolFor(attachedValue) === inputSymbol &&
    targetSameStoreEntry(registration, detachment, callback, scopes) &&
    targetSameStoreEntry(detachment, cleanup, callback, scopes)
  );
};
