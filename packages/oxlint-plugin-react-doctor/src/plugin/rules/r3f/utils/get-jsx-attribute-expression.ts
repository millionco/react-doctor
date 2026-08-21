import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { getAuthoritativeJsxAttribute } from "../../../utils/get-authoritative-jsx-attribute.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";

export const getJsxAttributeExpression = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
  attributeName: string,
): EsTreeNode | null | undefined => {
  const attribute = getAuthoritativeJsxAttribute(node.attributes, attributeName);
  if (!attribute) return undefined;
  if (
    !attribute.value ||
    !isNodeOfType(attribute.value, "JSXExpressionContainer") ||
    isNodeOfType(attribute.value.expression, "JSXEmptyExpression")
  ) {
    return null;
  }
  return attribute.value.expression;
};
