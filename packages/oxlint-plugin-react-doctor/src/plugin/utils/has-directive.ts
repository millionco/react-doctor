import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const hasDirective = (node: EsTreeNode, directive: string): boolean => {
  let statements: EsTreeNode[] | null = null;
  if (isNodeOfType(node, "Program")) {
    statements = node.body;
  } else if (
    (isNodeOfType(node, "FunctionDeclaration") ||
      isNodeOfType(node, "FunctionExpression") ||
      isNodeOfType(node, "ArrowFunctionExpression")) &&
    isNodeOfType(node.body, "BlockStatement")
  ) {
    statements = node.body.body;
  }
  if (statements === null) return false;
  for (const statement of statements) {
    if (!isNodeOfType(statement, "ExpressionStatement") || statement.directive === undefined) {
      return false;
    }
    if (statement.directive === directive) return true;
  }
  return false;
};
