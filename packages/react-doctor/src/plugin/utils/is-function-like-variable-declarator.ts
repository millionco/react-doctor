import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";

// HACK: barrier-frame predicate used by `createComponentPropStackTracker`
// - a non-component arrow / function-expression VariableDeclarator
// pushes an empty stack frame so closed-over names from an outer
// component don't leak into the helper's prop check.
export const isFunctionLikeVariableDeclarator = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "VariableDeclarator")) return false;
  return (
    isNodeOfType(node.init, "ArrowFunctionExpression") ||
    isNodeOfType(node.init, "FunctionExpression")
  );
};
