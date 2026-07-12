import { catchClauseRethrowsCaught } from "./catch-clause-rethrows-caught.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { isFunctionLike } from "./is-function-like.js";
import { isImmediatelyInvokedFunction } from "./is-immediately-invoked-function.js";
import { isNodeOfType } from "./is-node-of-type.js";

// The enclosing TryStatement that SWALLOWS a control-flow error (a thrown
// redirect()/notFound()) raised at `node`: its `try` BLOCK contains `node`,
// it has a catch handler, and that handler does not re-throw the caught
// binding. A try whose catch re-throws is transparent — the forwarded error
// escapes it, so the walk keeps climbing and an OUTER swallowing try/catch
// around a re-throwing inner one is still found. A throw inside a `catch` or
// `finally` clause propagates past its own try, and a bare try/finally
// swallows nothing, so the walk climbs past both. A throw inside a nested
// function runs later, outside the try's synchronous scope, so the walk
// stops at the first function boundary — unless the function is the callee
// of an immediately-invoked call (IIFE), which executes synchronously
// inside the try.
export const findGuardingTryStatement = (
  node: EsTreeNode,
): EsTreeNodeOfType<"TryStatement"> | null => {
  let child: EsTreeNode = node;
  let ancestor: EsTreeNode | null | undefined = node.parent;
  while (ancestor) {
    if (isFunctionLike(ancestor) && !isImmediatelyInvokedFunction(ancestor)) {
      return null;
    }
    if (
      isNodeOfType(ancestor, "TryStatement") &&
      ancestor.block === child &&
      ancestor.handler &&
      !catchClauseRethrowsCaught(ancestor.handler)
    ) {
      return ancestor;
    }
    child = ancestor;
    ancestor = ancestor.parent ?? null;
  }
  return null;
};
