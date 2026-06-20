import type { EsTreeNode } from "../ast/es-tree-node.js";
import { forEachChildNode } from "../ast/for-each-child-node.js";
import { isFunctionLike } from "../ast/is-function-like.js";
import { isNodeOfType } from "../ast/is-node-of-type.js";

// Every CFG owner in a program: the `Program` itself (its top-level code is
// a graph) plus every nested function-like. The shared driver for the
// per-function passes (SSA, definite-assignment) so they agree on exactly
// which scopes get a CFG.
export const enumerateFunctions = (program: EsTreeNode): EsTreeNode[] => {
  const functionNodes: EsTreeNode[] = [];
  if (isNodeOfType(program, "Program")) functionNodes.push(program);
  const collect = (node: EsTreeNode): void => {
    if (isFunctionLike(node)) functionNodes.push(node);
    forEachChildNode(node, collect);
  };
  collect(program);
  return functionNodes;
};
