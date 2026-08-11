import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { getStaticNumber } from "./get-static-number.js";

export const getStaticNumberArrayElement = (
  expression: EsTreeNode,
  index: number,
  scopes: ScopeAnalysis,
): number | null => {
  const candidate = stripParenExpression(expression);
  if (!isNodeOfType(candidate, "ArrayExpression")) return null;
  const element = candidate.elements[index];
  return element && !isNodeOfType(element, "SpreadElement")
    ? getStaticNumber(element, scopes)
    : null;
};
