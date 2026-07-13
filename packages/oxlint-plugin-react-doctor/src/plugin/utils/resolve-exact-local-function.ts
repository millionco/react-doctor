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
  if (symbol?.kind === "function") {
    const isReassigned = symbol.references.some((reference) => reference.flag !== "read");
    return !isReassigned && isFunctionLike(symbol.declarationNode) ? symbol.declarationNode : null;
  }
  if (symbol?.kind !== "const" || !symbol.initializer) return null;
  const unwrappedInitializer = stripParenExpression(symbol.initializer);
  return isFunctionLike(unwrappedInitializer) ? unwrappedInitializer : null;
};
