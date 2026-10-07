import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isSynchronousIteratorCallback } from "../../../utils/is-synchronous-iterator-callback.js";

const REPEATED_EXECUTION_NODE_TYPES: ReadonlySet<string> = new Set([
  "DoWhileStatement",
  "ForInStatement",
  "ForOfStatement",
  "ForStatement",
  "WhileStatement",
]);

export const isInsideRepeatedExecution = (node: EsTreeNode): boolean => {
  let current = node.parent ?? null;
  while (current) {
    if (REPEATED_EXECUTION_NODE_TYPES.has(current.type)) return true;
    if (isFunctionLike(current)) return isSynchronousIteratorCallback(current);
    current = current.parent ?? null;
  }
  return false;
};
