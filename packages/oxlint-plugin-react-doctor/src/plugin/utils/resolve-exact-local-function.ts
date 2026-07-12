import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { resolveConstIdentifierAlias } from "./resolve-const-identifier-alias.js";
import { stripParenExpression } from "./strip-paren-expression.js";

export const resolveExactLocalFunction = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
): EsTreeNode | null => {
  const unwrappedExpression = stripParenExpression(expression);
  if (isFunctionLike(unwrappedExpression)) return unwrappedExpression;
  if (!isNodeOfType(unwrappedExpression, "Identifier")) return null;
  const symbol = resolveConstIdentifierAlias(unwrappedExpression, scopes);
  if (!symbol || (symbol.kind !== "const" && symbol.kind !== "function")) return null;
  if (
    symbol.kind === "function" &&
    symbol.references.some((reference) => reference.flag !== "read")
  ) {
    return null;
  }
  const functionValue = symbol.kind === "function" ? symbol.declarationNode : symbol.initializer;
  if (!functionValue) return null;
  const unwrappedFunctionValue = stripParenExpression(functionValue);
  return isFunctionLike(unwrappedFunctionValue) ? unwrappedFunctionValue : null;
};
