import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

export const findImmediatelyInvokedCallExpression = (
  functionNode: EsTreeNode,
): EsTreeNodeOfType<"CallExpression"> | null => {
  let wrappedCallee = functionNode;
  let enclosing = functionNode.parent;
  while (enclosing && stripParenExpression(enclosing) === functionNode) {
    wrappedCallee = enclosing;
    enclosing = enclosing.parent ?? null;
  }
  return enclosing &&
    isNodeOfType(enclosing, "CallExpression") &&
    enclosing.callee === wrappedCallee
    ? enclosing
    : null;
};
