import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { resolveExactLocalFunction } from "./resolve-exact-local-function.js";

export const getEffectCallback = (node: EsTreeNode, scopes?: ScopeAnalysis): EsTreeNode | null => {
  if (!isNodeOfType(node, "CallExpression") && !isNodeOfType(node, "NewExpression")) return null;
  if (!node.arguments?.length) return null;
  const callback = node.arguments[0];
  if (
    isNodeOfType(callback, "ArrowFunctionExpression") ||
    isNodeOfType(callback, "FunctionExpression")
  ) {
    return callback;
  }
  return scopes ? resolveExactLocalFunction(callback, scopes) : null;
};
