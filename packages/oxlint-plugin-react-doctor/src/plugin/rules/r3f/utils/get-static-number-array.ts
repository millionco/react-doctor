import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { getStaticNumber } from "./get-static-number.js";

export const getStaticNumberArray = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
): ReadonlyArray<number> | null => {
  const candidate = stripParenExpression(expression);
  if (!isNodeOfType(candidate, "ArrayExpression")) return null;
  const values: number[] = [];
  for (const element of candidate.elements) {
    if (!element || isNodeOfType(element, "SpreadElement")) return null;
    const value = getStaticNumber(element, scopes);
    if (value === null) return null;
    values.push(value);
  }
  return values;
};
