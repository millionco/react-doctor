import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";

// True when a CallExpression's return value is discarded — it sits directly in
// statement position (`fn(x);`), optionally wrapped in a ChainExpression
// (`fn?.(x);`). A call whose result flows into an argument, initializer, or
// right-hand side (`setError(fn(x))`, `const y = fn(x)`) is NOT discarded: its
// value is consumed locally, so it isn't a fire-and-forget side effect.
export const isResultDiscardedCall = (callExpression: EsTreeNode): boolean => {
  let node: EsTreeNode = callExpression;
  let parent: EsTreeNode | null | undefined = node.parent;
  if (parent && isNodeOfType(parent, "ChainExpression")) {
    node = parent;
    parent = node.parent;
  }
  return Boolean(parent && isNodeOfType(parent, "ExpressionStatement"));
};
