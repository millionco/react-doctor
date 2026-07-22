import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { getThreeConstructorName } from "./get-three-constructor-name.js";

export const hasThreeObjectProvenance = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  let candidate = stripParenExpression(expression);
  while (isNodeOfType(candidate, "MemberExpression")) {
    candidate = stripParenExpression(candidate.object);
  }
  return getThreeConstructorName(candidate, scopes) !== null;
};
