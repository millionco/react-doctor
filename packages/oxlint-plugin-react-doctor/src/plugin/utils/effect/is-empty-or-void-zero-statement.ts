import type { EsTreeNode } from "../es-tree-node.js";
import { isNodeOfType } from "../is-node-of-type.js";
import { stripParenExpression } from "../strip-paren-expression.js";
import { OWNED_RENDERER_BUILDER_VOID_ZERO_LITERAL_VALUE } from "./owned-renderer-builder/constants.js";

export const isEmptyOrVoidZeroStatement = (statement: EsTreeNode): boolean => {
  if (isNodeOfType(statement, "EmptyStatement")) return true;
  if (!isNodeOfType(statement, "ExpressionStatement")) return false;
  const expression = stripParenExpression(statement.expression);
  if (!isNodeOfType(expression, "UnaryExpression") || expression.operator !== "void") return false;
  const argument = stripParenExpression(expression.argument);
  return (
    isNodeOfType(argument, "Literal") &&
    typeof argument.value === "number" &&
    argument.value === OWNED_RENDERER_BUILDER_VOID_ZERO_LITERAL_VALUE
  );
};
