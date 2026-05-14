import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const hasDirective = (programNode: EsTreeNode, directive: string): boolean => {
  if (!isNodeOfType(programNode, "Program")) return false;
  return Boolean(
    programNode.body?.some(
      (statement) =>
        isNodeOfType(statement, "ExpressionStatement") &&
        isNodeOfType(statement.expression, "Literal") &&
        statement.expression.value === directive,
    ),
  );
};
