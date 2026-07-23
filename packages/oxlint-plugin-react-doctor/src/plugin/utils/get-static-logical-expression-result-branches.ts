import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { getFinalSequenceExpressionValue } from "./get-final-sequence-expression-value.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const getStaticLogicalExpressionResultBranches = (
  expression: EsTreeNodeOfType<"LogicalExpression">,
): ReadonlyArray<EsTreeNode> => {
  const leftResult = getFinalSequenceExpressionValue(expression.left);
  if (!isNodeOfType(leftResult, "JSXElement") && !isNodeOfType(leftResult, "JSXFragment")) {
    return [expression.left, expression.right];
  }
  return expression.operator === "&&" ? [expression.right] : [leftResult];
};
