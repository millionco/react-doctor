import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

export const readStaticLiteralTruthiness = (node: EsTreeNode): boolean | null => {
  const expression = stripParenExpression(node);
  if (!isNodeOfType(expression, "Literal")) return null;
  if ("regex" in expression) return true;
  if ("bigint" in expression) {
    try {
      return Boolean(BigInt(expression.bigint));
    } catch {
      return null;
    }
  }
  if (
    expression.value === null ||
    typeof expression.value === "boolean" ||
    typeof expression.value === "number" ||
    typeof expression.value === "string"
  ) {
    return Boolean(expression.value);
  }
  return null;
};
