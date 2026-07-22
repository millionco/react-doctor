import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";

export const getControlFlowTest = (node: EsTreeNode): EsTreeNode | null => {
  if (
    isNodeOfType(node, "IfStatement") ||
    isNodeOfType(node, "WhileStatement") ||
    isNodeOfType(node, "DoWhileStatement") ||
    isNodeOfType(node, "ConditionalExpression")
  ) {
    return node.test;
  }
  if (isNodeOfType(node, "SwitchStatement")) return node.discriminant;
  if (isNodeOfType(node, "ForStatement")) return node.test;
  if (isNodeOfType(node, "LogicalExpression")) return node.left;
  return null;
};
