import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const getCallbackStatements = (callback: EsTreeNode): EsTreeNode[] => {
  if (
    !isNodeOfType(callback, "ArrowFunctionExpression") &&
    !isNodeOfType(callback, "FunctionExpression") &&
    !isNodeOfType(callback, "FunctionDeclaration")
  ) {
    return [];
  }
  if (isNodeOfType(callback.body, "BlockStatement")) {
    return callback.body.body ?? [];
  }
  return callback.body ? [callback.body] : [];
};
