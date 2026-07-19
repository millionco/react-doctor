import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isReactApiCall } from "./is-react-api-call.js";
import { resolveConstIdentifierAlias } from "./resolve-const-identifier-alias.js";
import { stripParenExpression } from "./strip-paren-expression.js";

export const getReactUseCallbackCall = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
): EsTreeNodeOfType<"CallExpression"> | null => {
  const identifier = stripParenExpression(expression);
  if (!isNodeOfType(identifier, "Identifier")) return null;
  const symbol = resolveConstIdentifierAlias(identifier, scopes);
  if (symbol?.kind !== "const" || !symbol.initializer) return null;
  const initializer = stripParenExpression(symbol.initializer);
  return isNodeOfType(initializer, "CallExpression") &&
    isReactApiCall(initializer, "useCallback", scopes, {
      allowGlobalReactNamespace: true,
      resolveNamedAliases: true,
    })
    ? initializer
    : null;
};
