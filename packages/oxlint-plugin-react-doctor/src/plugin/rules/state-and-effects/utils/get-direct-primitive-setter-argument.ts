import type { Reference } from "eslint-scope";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { getCallExpr } from "./effect/ast.js";

export const getDirectPrimitiveSetterArgument = (
  setterReference: Reference,
): EsTreeNodeOfType<"Literal"> | null => {
  const setterCall = getCallExpr(setterReference);
  if (
    !isNodeOfType(setterCall, "CallExpression") ||
    stripParenExpression(setterCall.callee) !== setterReference.identifier ||
    setterCall.arguments.length !== 1
  ) {
    return null;
  }
  const argument = stripParenExpression(setterCall.arguments[0]);
  if (!isNodeOfType(argument, "Literal") || "regex" in argument || "bigint" in argument) {
    return null;
  }
  return argument.value === null ||
    typeof argument.value === "boolean" ||
    typeof argument.value === "number" ||
    typeof argument.value === "string"
    ? argument
    : null;
};
