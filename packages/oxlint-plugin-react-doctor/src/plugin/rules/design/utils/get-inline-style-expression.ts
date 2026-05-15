import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";

export const getInlineStyleExpression = (
  node: EsTreeNodeOfType<"JSXAttribute">,
): EsTreeNodeOfType<"ObjectExpression"> | null => {
  if (!isNodeOfType(node.name, "JSXIdentifier") || node.name.name !== "style") return null;
  if (!isNodeOfType(node.value, "JSXExpressionContainer")) return null;
  const expression = node.value.expression;
  if (!isNodeOfType(expression, "ObjectExpression")) return null;
  return expression;
};
