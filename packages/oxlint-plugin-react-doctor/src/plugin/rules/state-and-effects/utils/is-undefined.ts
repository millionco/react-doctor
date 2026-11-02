import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";

export const isUndefined = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const value = stripParenExpression(node);
  return (
    (isNodeOfType(value, "Identifier") &&
      value.name === "undefined" &&
      scopes.isGlobalReference(value)) ||
    (isNodeOfType(value, "UnaryExpression") &&
      value.operator === "void" &&
      isNodeOfType(value.argument, "Literal") &&
      value.argument.value === 0)
  );
};
