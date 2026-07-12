import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const getStaticPropertyName = (
  memberExpression: EsTreeNodeOfType<"MemberExpression">,
): string | null => {
  const property = memberExpression.property as EsTreeNode;
  if (!memberExpression.computed && isNodeOfType(property, "Identifier")) return property.name;
  if (memberExpression.computed && isNodeOfType(property, "Literal")) {
    return typeof property.value === "string" ? property.value : null;
  }
  if (
    memberExpression.computed &&
    isNodeOfType(property, "TemplateLiteral") &&
    property.expressions.length === 0
  ) {
    return property.quasis[0]?.value.cooked ?? property.quasis[0]?.value.raw ?? null;
  }
  return null;
};
