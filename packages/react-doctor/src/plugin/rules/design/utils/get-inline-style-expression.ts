import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";

export const getInlineStyleExpression = (node: EsTreeNode): EsTreeNode | null => {
  if (!isNodeOfType(node.name, "JSXIdentifier") || node.name.name !== "style") return null;
  if (!isNodeOfType(node.value, "JSXExpressionContainer")) return null;
  const expression = node.value.expression;
  if (!isNodeOfType(expression, "ObjectExpression")) return null;
  return expression;
};
