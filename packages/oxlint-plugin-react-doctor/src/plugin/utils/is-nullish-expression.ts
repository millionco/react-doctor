import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";

// True for the two statically-nullish expression shapes: the `null`
// literal and the bare `undefined` identifier. Intentionally does NOT
// include `void 0` — callers that also treat a `void` UnaryExpression as
// nullish (button-has-type's `createElement` props arg) add that case
// themselves, so JSX-child callers keep `{void 0}` as a rendered child.
export const isNullishExpression = (expression: EsTreeNode): boolean =>
  (isNodeOfType(expression, "Literal") && expression.value === null) ||
  (isNodeOfType(expression, "Identifier") && expression.name === "undefined");
