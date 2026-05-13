import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const hasDirective = (programNode: EsTreeNode, directive: string): boolean =>
  Boolean(
    programNode.body?.some(
      (statement: EsTreeNode) =>
        isNodeOfType(statement, "ExpressionStatement") &&
        isNodeOfType(statement.expression, "Literal") &&
        statement.expression.value === directive,
    ),
  );
