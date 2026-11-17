import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getDirectConstInitializer } from "./get-direct-const-initializer.js";
import { getSingleReturnExpression } from "./get-single-return-expression.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isSymbolReadOnly } from "./is-symbol-read-only.js";
import { resolveConstIdentifierAlias } from "./resolve-const-identifier-alias.js";
import { stripParenExpression } from "./strip-paren-expression.js";

export const isPureIdentityFunction = (expression: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  let functionNode = stripParenExpression(expression);
  if (isNodeOfType(functionNode, "Identifier")) {
    const symbol = resolveConstIdentifierAlias(functionNode, scopes);
    if (!symbol || !isSymbolReadOnly(symbol)) return false;
    const declaration = getDirectConstInitializer(symbol);
    if (!declaration) return false;
    functionNode = stripParenExpression(declaration);
  }
  if (!isFunctionLike(functionNode) || functionNode.async || functionNode.generator) return false;
  const [parameter, ...remainingParameters] = functionNode.params;
  if (!isNodeOfType(parameter, "Identifier") || remainingParameters.length) return false;
  const returnedExpression = getSingleReturnExpression(functionNode);
  if (!returnedExpression) return false;
  const returnedValue = stripParenExpression(returnedExpression);
  if (!isNodeOfType(returnedValue, "Identifier")) return false;
  const parameterSymbol = scopes.symbolFor(parameter);
  return Boolean(parameterSymbol && scopes.symbolFor(returnedValue)?.id === parameterSymbol.id);
};
