import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";

// The enclosing TryStatement whose `try` BLOCK contains `node` AND that has a
// catch handler — the only shape that can swallow a control-flow error (a
// thrown redirect()/notFound()) raised at `node`. A throw inside the `catch`
// or `finally` clause propagates past that try (the walk keeps climbing, so
// an OUTER swallowing try/catch is still found), a bare try/finally swallows
// nothing, and a throw inside a nested function runs later, outside the try's
// synchronous scope — so the walk stops at the first function boundary.
export const findGuardingTryStatement = (
  node: EsTreeNode,
): EsTreeNodeOfType<"TryStatement"> | null => {
  let child: EsTreeNode = node;
  let ancestor: EsTreeNode | null | undefined = node.parent;
  while (ancestor) {
    if (isFunctionLike(ancestor)) {
      return null;
    }
    if (
      isNodeOfType(ancestor, "TryStatement") &&
      ancestor.block === child &&
      Boolean(ancestor.handler)
    ) {
      return ancestor;
    }
    child = ancestor;
    ancestor = ancestor.parent ?? null;
  }
  return null;
};
