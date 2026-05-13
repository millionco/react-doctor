import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const hasUseServerDirective = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node.body, "BlockStatement")) return false;
  return Boolean(
    node.body.body?.some(
      (statement: EsTreeNode) =>
        isNodeOfType(statement, "ExpressionStatement") && statement.directive === "use server",
    ),
  );
};
