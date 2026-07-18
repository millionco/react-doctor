import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const hasDirective = (programNode: EsTreeNode, directive: string): boolean => {
  if (!isNodeOfType(programNode, "Program")) return false;
  for (const statement of programNode.body) {
    if (!isNodeOfType(statement, "ExpressionStatement") || statement.directive === undefined) {
      return false;
    }
    if (statement.directive === directive) return true;
  }
  return false;
};
