import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import { findDeclaratorForBinding } from "./find-declarator-for-binding.js";
import { findVariableInitializer } from "./find-variable-initializer.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isReactApiCall } from "./is-react-api-call.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import type { EsTreeNode } from "./es-tree-node.js";

const readLogicalResult = (
  operator: "&&" | "||",
  leftResult: boolean | null,
  rightResult: boolean | null,
): boolean | null => {
  if (operator === "&&") {
    if (leftResult === false || rightResult === false) return false;
    if (leftResult === true && rightResult === true) return true;
    return null;
  }
  if (leftResult === true || rightResult === true) return true;
  if (leftResult === false && rightResult === false) return false;
  return null;
};

const readIdentifierInitialStateBoolean = (
  identifier: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedBindings: Set<EsTreeNode>,
  allowLazyInitializer: boolean,
): boolean | null => {
  if (!isNodeOfType(identifier, "Identifier")) return null;
  if (identifier.name === "undefined" && scopes.isGlobalReference(identifier)) return false;
  const binding = findVariableInitializer(identifier, identifier.name);
  if (!binding || visitedBindings.has(binding.bindingIdentifier)) return null;
  visitedBindings.add(binding.bindingIdentifier);
  const declarator = findDeclaratorForBinding(binding.bindingIdentifier);
  if (!declarator?.init || scopes.symbolFor(identifier)?.declarationNode !== declarator)
    return null;
  const initializer = stripParenExpression(declarator.init);
  if (
    isNodeOfType(declarator.id, "ArrayPattern") &&
    declarator.id.elements?.[0] === binding.bindingIdentifier &&
    isReactApiCall(initializer, "useState", scopes, { allowGlobalReactNamespace: true }) &&
    isNodeOfType(initializer, "CallExpression")
  ) {
    const initialState = initializer.arguments?.[0];
    if (!initialState) return false;
    if (initialState.type === "SpreadElement") return null;
    return readInitialStateBooleanInternal(initialState, scopes, visitedBindings, true);
  }
  const declaration = declarator.parent;
  if (
    !isNodeOfType(declarator.id, "Identifier") ||
    declarator.id !== binding.bindingIdentifier ||
    !isNodeOfType(declaration, "VariableDeclaration") ||
    declaration.kind !== "const"
  ) {
    return null;
  }
  return readInitialStateBooleanInternal(
    initializer,
    scopes,
    visitedBindings,
    allowLazyInitializer,
  );
};

const readInitialStateBooleanInternal = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedBindings: Set<EsTreeNode>,
  allowLazyInitializer: boolean,
): boolean | null => {
  const unwrappedExpression = stripParenExpression(expression);
  if (isNodeOfType(unwrappedExpression, "Literal")) {
    return Boolean(unwrappedExpression.value);
  }
  if (isNodeOfType(unwrappedExpression, "Identifier")) {
    return readIdentifierInitialStateBoolean(
      unwrappedExpression,
      scopes,
      visitedBindings,
      allowLazyInitializer,
    );
  }
  if (
    allowLazyInitializer &&
    (isNodeOfType(unwrappedExpression, "ArrowFunctionExpression") ||
      isNodeOfType(unwrappedExpression, "FunctionExpression"))
  ) {
    if (
      unwrappedExpression.async ||
      (isNodeOfType(unwrappedExpression, "FunctionExpression") && unwrappedExpression.generator)
    ) {
      return null;
    }
    if (!isNodeOfType(unwrappedExpression.body, "BlockStatement")) {
      return readInitialStateBooleanInternal(
        unwrappedExpression.body,
        scopes,
        visitedBindings,
        false,
      );
    }
    if (unwrappedExpression.body.body.length !== 1) return null;
    const returnStatement = unwrappedExpression.body.body[0];
    if (!isNodeOfType(returnStatement, "ReturnStatement") || !returnStatement.argument) return null;
    return readInitialStateBooleanInternal(
      returnStatement.argument,
      scopes,
      visitedBindings,
      false,
    );
  }
  if (
    isNodeOfType(unwrappedExpression, "UnaryExpression") &&
    unwrappedExpression.operator === "!"
  ) {
    const argumentResult = readInitialStateBooleanInternal(
      unwrappedExpression.argument,
      scopes,
      visitedBindings,
      false,
    );
    return argumentResult === null ? null : !argumentResult;
  }
  if (
    isNodeOfType(unwrappedExpression, "LogicalExpression") &&
    (unwrappedExpression.operator === "&&" || unwrappedExpression.operator === "||")
  ) {
    return readLogicalResult(
      unwrappedExpression.operator,
      readInitialStateBooleanInternal(
        unwrappedExpression.left,
        scopes,
        new Set(visitedBindings),
        false,
      ),
      readInitialStateBooleanInternal(
        unwrappedExpression.right,
        scopes,
        new Set(visitedBindings),
        false,
      ),
    );
  }
  return null;
};

export const readInitialStateBoolean = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean | null => readInitialStateBooleanInternal(expression, scopes, new Set(), false);
