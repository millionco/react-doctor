import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";

// A statement of the form `await expr;` — an `ExpressionStatement` whose
// expression is directly an `AwaitExpression`. Used by `async-defer-await`
// to recognise bare awaits (no binding) alongside `const x = await …;`.
export const isBareAwaitExpressionStatement = (statement: EsTreeNode): boolean => {
  if (!isNodeOfType(statement, "ExpressionStatement")) return false;
  return isNodeOfType(statement.expression, "AwaitExpression");
};
