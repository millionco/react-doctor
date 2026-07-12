import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

export const isImmediatelyInvokedFunction = (functionNode: EsTreeNode): boolean => {
  let wrappedCallee = functionNode;
  let enclosing = functionNode.parent;
  while (enclosing && stripParenExpression(enclosing) === functionNode) {
    wrappedCallee = enclosing;
    enclosing = enclosing.parent ?? null;
  }
  return Boolean(
    enclosing && isNodeOfType(enclosing, "CallExpression") && enclosing.callee === wrappedCallee,
  );
};
