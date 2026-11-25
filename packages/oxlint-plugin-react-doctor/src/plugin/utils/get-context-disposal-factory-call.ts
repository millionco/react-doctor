import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

// Setting-independent admission only; no filesystem or provider reads.
export const getContextDisposalFactoryCall = (
  callback: EsTreeNode,
): EsTreeNodeOfType<"CallExpression"> | null => {
  if (
    !isNodeOfType(callback, "ArrowFunctionExpression") ||
    callback.async ||
    isNodeOfType(callback.body, "BlockStatement")
  )
    return null;
  const call = stripParenExpression(callback.body);
  return isNodeOfType(call, "CallExpression") &&
    !call.optional &&
    call.arguments.length >= 2 &&
    isNodeOfType(call.callee, "Identifier")
    ? call
    : null;
};
