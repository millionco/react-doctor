import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";

export const getStaticMemberPropertyName = (node: EsTreeNode | null | undefined): string | null => {
  if (!node) return null;

  const unwrappedNode = stripParenExpression(node);
  if (!isNodeOfType(unwrappedNode, "MemberExpression")) return null;

  if (!unwrappedNode.computed && isNodeOfType(unwrappedNode.property, "Identifier")) {
    return unwrappedNode.property.name;
  }

  if (
    unwrappedNode.computed &&
    isNodeOfType(unwrappedNode.property, "Literal") &&
    typeof unwrappedNode.property.value === "string"
  ) {
    return unwrappedNode.property.value;
  }

  return null;
};
