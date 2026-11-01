import type { EsTreeNode } from "./es-tree-node.js";
import { getRootIdentifier } from "./get-root-identifier.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const isCallReceiverOrCalleeRead = (node: EsTreeNode): boolean => {
  let ancestor = node.parent;
  while (ancestor && !isFunctionLike(ancestor)) {
    if (isNodeOfType(ancestor, "CallExpression") || isNodeOfType(ancestor, "NewExpression")) {
      return getRootIdentifier(ancestor.callee) === node;
    }
    ancestor = ancestor.parent;
  }
  return false;
};
