import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";

// True for the statically-nullish expression shapes: the `null` literal,
// the bare `undefined` identifier, and a `void …` UnaryExpression (which
// always evaluates to `undefined`). React renders all three as nothing,
// and none can carry a prop value.
export const isNullishExpression = (expression: EsTreeNode): boolean =>
  (isNodeOfType(expression, "Literal") && expression.value === null) ||
  (isNodeOfType(expression, "Identifier") && expression.name === "undefined") ||
  (isNodeOfType(expression, "UnaryExpression") && expression.operator === "void");
