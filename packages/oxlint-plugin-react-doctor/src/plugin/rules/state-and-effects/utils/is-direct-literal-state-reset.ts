import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";

export const isDirectLiteralStateReset = (
  declarator: EsTreeNode | null,
  writtenValue: EsTreeNode | undefined,
): boolean => {
  if (!isNodeOfType(declarator, "VariableDeclarator")) return false;
  if (!isNodeOfType(declarator.init, "CallExpression")) return false;
  const initialValue = declarator.init.arguments[0];
  if (!initialValue || !writtenValue) return false;
  const initial = stripParenExpression(initialValue);
  const next = stripParenExpression(writtenValue);
  return (
    isNodeOfType(initial, "Literal") &&
    isNodeOfType(next, "Literal") &&
    !("regex" in initial || "regex" in next || "bigint" in initial || "bigint" in next) &&
    Object.is(initial.value, next.value)
  );
};
