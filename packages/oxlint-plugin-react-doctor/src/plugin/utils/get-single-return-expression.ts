import type { EsTreeNode } from "./es-tree-node.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const getSingleReturnExpression = (functionNode: EsTreeNode): EsTreeNode | null => {
  if (!isFunctionLike(functionNode)) return null;
  if (!isNodeOfType(functionNode.body, "BlockStatement")) return functionNode.body;
  if (functionNode.body.body.length !== 1) return null;
  const statement = functionNode.body.body[0];
  return isNodeOfType(statement, "ReturnStatement") && statement.argument
    ? statement.argument
    : null;
};
