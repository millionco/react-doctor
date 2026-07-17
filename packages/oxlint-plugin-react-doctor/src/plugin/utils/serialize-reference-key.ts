import type { EsTreeNode } from "./es-tree-node.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

export const serializeReferenceKey = (node: EsTreeNode): string | null => {
  const expression = stripParenExpression(node);
  if (isNodeOfType(expression, "Identifier")) return expression.name;
  if (isNodeOfType(expression, "ThisExpression")) return "this";
  if (!isNodeOfType(expression, "MemberExpression")) return null;
  const receiverKey = serializeReferenceKey(expression.object);
  const propertyName = getStaticPropertyName(expression);
  return receiverKey && propertyName ? `${receiverKey}.${propertyName}` : null;
};
