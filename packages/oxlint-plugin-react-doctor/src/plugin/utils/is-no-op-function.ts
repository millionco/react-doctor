import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isNoOpExpression } from "./is-no-op-expression.js";
import { isNoOpStatement } from "./is-no-op-statement.js";
import type { EsTreeNode } from "./es-tree-node.js";

export const isNoOpFunction = (node: EsTreeNode): boolean => {
  if (!isFunctionLike(node)) return false;
  if (!node.params.every((parameter) => isNodeOfType(parameter, "Identifier"))) return false;
  if (isNodeOfType(node.body, "BlockStatement")) return node.body.body.every(isNoOpStatement);
  return Boolean(node.body) && isNoOpExpression(node.body);
};
