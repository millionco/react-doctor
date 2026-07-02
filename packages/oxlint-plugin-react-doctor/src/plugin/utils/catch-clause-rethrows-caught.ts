import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { walkAst } from "./walk-ast.js";

const doesThrowEscapeCatchClause = (
  throwStatement: EsTreeNodeOfType<"ThrowStatement">,
  handler: EsTreeNodeOfType<"CatchClause">,
): boolean => {
  let child: EsTreeNode = throwStatement;
  let ancestor: EsTreeNode | null | undefined = throwStatement.parent;
  while (ancestor && ancestor !== handler) {
    if (
      isNodeOfType(ancestor, "TryStatement") &&
      ancestor.block === child &&
      ancestor.handler &&
      !catchClauseRethrowsCaught(ancestor.handler)
    ) {
      return false;
    }
    child = ancestor;
    ancestor = ancestor.parent ?? null;
  }
  return true;
};

// True when a catch clause re-throws its CAUGHT binding (`throw error`),
// forwarding a control-flow error instead of swallowing it — the documented
// safe pattern for redirect()/notFound() (`if (isRedirect(e)) throw e`).
// INTENDED IMPRECISION: any reachable `throw error` counts, even under a
// condition that can never match the redirect error (`if (e instanceof
// DbError) throw e`) — static condition analysis is out of scope, and
// accepting any rethrow keeps the documented isRedirectError guard silent.
// A catch that only logs/returns, or throws a FRESH error, does NOT
// re-throw. Nested functions are pruned so a `throw` in a later-running
// callback doesn't count, and a rethrow nested inside a try (within the
// catch body) whose own catch swallows it doesn't count either — that
// error never escapes the catch clause.
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
      child.argument.name === caughtBindingName &&
      doesThrowEscapeCatchClause(child, handler)
    ) {
      didRethrow = true;
      return false;
    }
  });
  return didRethrow;
};
