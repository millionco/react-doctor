import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { getDirectConstInitializer } from "../../../utils/get-direct-const-initializer.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { resolveConstIdentifierAlias } from "../../../utils/resolve-const-identifier-alias.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";

const isPrimitiveLiteral = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "Literal") &&
  (node.value === null ||
    typeof node.value === "string" ||
    typeof node.value === "number" ||
    typeof node.value === "boolean" ||
    typeof node.value === "bigint");

const getReadonlyAliasRoot = (
  identifier: EsTreeNode,
  scopes: ScopeAnalysis,
): SymbolDescriptor | null => {
  const root = resolveConstIdentifierAlias(identifier, scopes);
  if (!root) return null;
  let symbol = scopes.symbolFor(identifier);
  while (symbol) {
    if (
      symbol.references.some(
        (reference) =>
          !isTypeScriptTypePosition(reference.identifier) &&
          (reference.flag !== "read" || isWithinAssignmentTarget(reference.identifier)),
      )
    )
      return null;
    if (symbol === root) return root;
    const initializer = getDirectConstInitializer(symbol);
    if (!initializer) return null;
    const alias = stripParenExpression(initializer);
    if (!isNodeOfType(alias, "Identifier")) return null;
    symbol = scopes.symbolFor(alias);
  }
  return null;
};

const getPrimitiveInitializer = (
  expression: EsTreeNode | null | undefined,
  scopes: ScopeAnalysis,
): EsTreeNode | null => {
  if (!expression) return null;
  const input = stripParenExpression(expression);
  if (isPrimitiveLiteral(input)) return input;
  if (!isNodeOfType(input, "Identifier")) return null;
  const symbol = getReadonlyAliasRoot(input, scopes);
  const initializer = symbol && getDirectConstInitializer(symbol);
  if (!initializer) return null;
  const literal = stripParenExpression(initializer);
  return isPrimitiveLiteral(literal) ? literal : null;
};

const getCommandInput = (
  expression: EsTreeNode,
  ownerFunction: EsTreeNode,
  allowedFrame: EsTreeNode | null,
  scopes: ScopeAnalysis,
): EsTreeNode | null => {
  const input = stripParenExpression(expression);
  if (isPrimitiveLiteral(input)) return input;
  if (!isNodeOfType(input, "Identifier")) return null;
  const parameter = getReadonlyAliasRoot(input, scopes);
  return parameter?.kind === "parameter" &&
    (parameter.scope.node === ownerFunction || parameter.scope.node === allowedFrame)
    ? parameter.bindingIdentifier
    : null;
};

export const isImperativeRefCommandInput = (
  expression: EsTreeNode,
  ownerFunction: EsTreeNode,
  scopes: ScopeAnalysis,
  refInitializer: EsTreeNode | null | undefined,
  invocation: EsTreeNode | null,
): boolean => {
  let input = getCommandInput(expression, ownerFunction, findEnclosingFunction(expression), scopes);
  if (!input) return false;
  if (isNodeOfType(input, "Identifier")) {
    const parameter = scopes.symbolFor(input);
    if (!parameter || parameter.kind !== "parameter") return false;
    if (parameter.scope.node === ownerFunction) return true;
    const functionNode = parameter.scope.node;
    if (!isFunctionLike(functionNode) || !isNodeOfType(invocation, "CallExpression")) return false;
    const parameterIndex = functionNode.params.findIndex(
      (candidate) => candidate === parameter.bindingIdentifier,
    );
    const argument = invocation.arguments[parameterIndex];
    if (!argument || isNodeOfType(argument, "SpreadElement")) return false;
    input = getCommandInput(argument, ownerFunction, ownerFunction, scopes);
    if (!input) return false;
    if (isNodeOfType(input, "Identifier")) return true;
  }
  const initialValue = getPrimitiveInitializer(refInitializer, scopes);
  return !(
    isNodeOfType(input, "Literal") &&
    isNodeOfType(initialValue, "Literal") &&
    input.value === initialValue.value
  );
};
