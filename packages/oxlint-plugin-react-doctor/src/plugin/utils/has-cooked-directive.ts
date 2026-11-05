import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const hasCookedDirective = (
  statements: ReadonlyArray<EsTreeNode>,
  directive: string,
): boolean => {
  for (const statement of statements) {
    if (
      !isNodeOfType(statement, "ExpressionStatement") ||
      typeof statement.directive !== "string"
    ) {
      return false;
    }
    if (isNodeOfType(statement.expression, "Literal") && statement.expression.value === directive) {
      return true;
    }
  }
  return false;
};
