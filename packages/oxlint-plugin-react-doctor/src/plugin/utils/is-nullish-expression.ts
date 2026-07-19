import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

// True for the statically-nullish expression shapes: the `null` literal,
// the bare `undefined` identifier, and a `void …` UnaryExpression (which
// always evaluates to `undefined`). React renders all three as nothing,
// and none can carry a prop value.
export const isNullishExpression = (expression: EsTreeNode): boolean => {
  const candidate = stripParenExpression(expression);
  return (
    (isNodeOfType(candidate, "Literal") && candidate.value === null) ||
    (isNodeOfType(candidate, "Identifier") && candidate.name === "undefined") ||
    (isNodeOfType(candidate, "UnaryExpression") && candidate.operator === "void")
  );
};
