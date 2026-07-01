import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { walkAst } from "./walk-ast.js";

// True when a catch clause re-throws its CAUGHT binding (`throw error`),
// forwarding a control-flow error instead of swallowing it — the documented
// safe pattern for redirect()/notFound() (`if (isRedirect(e)) throw e`). A
// catch that only logs/returns, or throws a FRESH error, does NOT re-throw.
// Nested functions are pruned so a `throw` in a later-running callback doesn't count.
export const catchClauseRethrowsCaught = (handler: EsTreeNodeOfType<"CatchClause">): boolean => {
  const caughtBindingName = isNodeOfType(handler.param, "Identifier") ? handler.param.name : null;
  if (!caughtBindingName) return false;
  let didRethrow = false;
  walkAst(handler.body, (child: EsTreeNode) => {
    if (didRethrow) return false;
    if (child !== handler.body && isFunctionLike(child)) return false;
    if (
      isNodeOfType(child, "ThrowStatement") &&
      isNodeOfType(child.argument, "Identifier") &&
      child.argument.name === caughtBindingName
    ) {
      didRethrow = true;
      return false;
    }
  });
  return didRethrow;
};
