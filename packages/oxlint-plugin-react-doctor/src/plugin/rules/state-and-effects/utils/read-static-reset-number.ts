import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { resolveConstIdentifierAlias } from "../../../utils/resolve-const-identifier-alias.js";

export const readStaticResetNumber = (value: EsTreeNode, scopes: ScopeAnalysis): number | null => {
  const symbol = isNodeOfType(value, "Identifier")
    ? resolveConstIdentifierAlias(value, scopes)
    : null;
  const expression = symbol?.kind === "const" ? symbol.initializer : value;
  if (isNodeOfType(expression, "Literal") && typeof expression.value === "number") {
    return Number.isFinite(expression.value) ? expression.value : null;
  }
  if (
    isNodeOfType(expression, "UnaryExpression") &&
    expression.operator === "-" &&
    isNodeOfType(expression.argument, "Literal") &&
    typeof expression.argument.value === "number" &&
    Number.isFinite(expression.argument.value)
  ) {
    return -expression.argument.value;
  }
  return null;
};
