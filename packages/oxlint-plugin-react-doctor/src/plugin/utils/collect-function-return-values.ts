import type { EsTreeNode } from "./es-tree-node.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { walkOwnFunctionScope } from "./walk-own-function-scope.js";

export const collectFunctionReturnValues = (functionNode: EsTreeNode): EsTreeNode[] | null => {
  if (!isFunctionLike(functionNode)) return null;
  if (!isNodeOfType(functionNode.body, "BlockStatement")) {
    return [functionNode.body];
  }
  const returnValues: EsTreeNode[] = [];
  let hasUnprovenReturn = false;
  walkOwnFunctionScope(functionNode, (child: EsTreeNode) => {
    if (!isNodeOfType(child, "ReturnStatement")) return;
    if (!child.argument) {
      hasUnprovenReturn = true;
      return;
    }
    returnValues.push(child.argument);
  });
  return !hasUnprovenReturn && returnValues.length > 0 ? returnValues : null;
};
