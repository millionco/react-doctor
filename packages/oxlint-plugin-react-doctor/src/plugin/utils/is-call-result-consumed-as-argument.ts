import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";

// True when a CallExpression's return value flows into the argument slot of
// another call or constructor (`setDisplay(format(amount))`), stepping
// through an optional-chain wrapper (`setDisplay(format?.(amount))`).
export const isCallResultConsumedAsArgument = (callExpression: EsTreeNode): boolean => {
  let node: EsTreeNode = callExpression;
  let parent: EsTreeNode | null | undefined = node.parent;
  if (parent && isNodeOfType(parent, "ChainExpression")) {
    node = parent;
    parent = node.parent;
  }
  if (!parent) return false;
  if (isNodeOfType(parent, "CallExpression") || isNodeOfType(parent, "NewExpression")) {
    return (parent.arguments ?? []).some((argument) => argument === node);
  }
  return false;
};
