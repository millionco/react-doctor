import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { getThreeConstructorName } from "./get-three-constructor-name.js";

export interface ThreePropertyAssignment {
  constructorName: string;
  propertyName: string;
  value: EsTreeNode;
}

export const getThreePropertyAssignment = (
  node: EsTreeNodeOfType<"AssignmentExpression">,
  context: RuleContext,
): ThreePropertyAssignment | null => {
  if (node.operator !== "=" || !isNodeOfType(node.left, "MemberExpression")) return null;
  const propertyName = getStaticPropertyName(node.left);
  const constructorName = getThreeConstructorName(node.left.object, context.scopes);
  return propertyName && constructorName
    ? { constructorName, propertyName, value: node.right }
    : null;
};
