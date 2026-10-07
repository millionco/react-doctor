import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { getFinalSequenceExpressionValue } from "./get-final-sequence-expression-value.js";
import { getStaticLogicalExpressionResultBranches } from "./get-static-logical-expression-result-branches.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { readStaticBoolean } from "./read-static-boolean.js";
import { stripParenExpression } from "./strip-paren-expression.js";

export interface StaticJsxDescendantOptions {
  readonly includeStaticExpressionBranches?: boolean;
}

const appendDescendant = (
  node: EsTreeNode,
  descendants: Array<EsTreeNodeOfType<"JSXOpeningElement">>,
  includeStaticExpressionBranches: boolean,
): void => {
  const expression = stripParenExpression(node);
  if (isNodeOfType(expression, "JSXElement")) {
    descendants.push(expression.openingElement);
    for (const child of expression.children) {
      appendDescendant(child, descendants, includeStaticExpressionBranches);
    }
    return;
  }
  if (isNodeOfType(expression, "JSXFragment")) {
    for (const child of expression.children) {
      appendDescendant(child, descendants, includeStaticExpressionBranches);
    }
    return;
  }
  if (!includeStaticExpressionBranches) return;
  if (isNodeOfType(expression, "JSXExpressionContainer")) {
    appendDescendant(expression.expression, descendants, true);
    return;
  }
  if (isNodeOfType(expression, "ConditionalExpression")) {
    const staticTestValue = readStaticBoolean(getFinalSequenceExpressionValue(expression.test));
    if (staticTestValue !== null) {
      appendDescendant(
        staticTestValue ? expression.consequent : expression.alternate,
        descendants,
        true,
      );
      return;
    }
    appendDescendant(expression.consequent, descendants, true);
    appendDescendant(expression.alternate, descendants, true);
    return;
  }
  if (isNodeOfType(expression, "LogicalExpression")) {
    for (const resultBranch of getStaticLogicalExpressionResultBranches(expression)) {
      appendDescendant(resultBranch, descendants, true);
    }
    return;
  }
  if (isNodeOfType(expression, "ArrayExpression")) {
    for (const element of expression.elements) {
      if (element && !isNodeOfType(element, "SpreadElement")) {
        appendDescendant(element, descendants, true);
      }
    }
    return;
  }
  if (isNodeOfType(expression, "SequenceExpression")) {
    if (expression.expressions.length === 0) return;
    appendDescendant(getFinalSequenceExpressionValue(expression), descendants, true);
  }
};

export const getStaticJsxDescendantOpeningElements = (
  element: EsTreeNodeOfType<"JSXElement">,
  options: StaticJsxDescendantOptions = {},
): Array<EsTreeNodeOfType<"JSXOpeningElement">> => {
  const descendants: Array<EsTreeNodeOfType<"JSXOpeningElement">> = [];
  for (const child of element.children) {
    appendDescendant(child, descendants, options.includeStaticExpressionBranches === true);
  }
  return descendants;
};
