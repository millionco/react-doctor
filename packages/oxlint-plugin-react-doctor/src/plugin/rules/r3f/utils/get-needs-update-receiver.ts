import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";

export const getNeedsUpdateReceiver = (
  node: EsTreeNodeOfType<"AssignmentExpression">,
): EsTreeNode | null => {
  const target = stripParenExpression(node.left);
  const value = stripParenExpression(node.right);
  return node.operator === "=" &&
    isNodeOfType(target, "MemberExpression") &&
    getStaticPropertyName(target) === "needsUpdate" &&
    isNodeOfType(value, "Literal") &&
    value.value === true
    ? target.object
    : null;
};
